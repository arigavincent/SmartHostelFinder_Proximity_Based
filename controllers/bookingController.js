const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const Booking = require('../models/Booking');
const Hostel = require('../models/Hostel');
const PaymentTransaction = require('../models/PaymentTransaction');
const { initiateSTKPush, querySTKStatus } = require('../utils/mpesa');
const { sendEmailMessage } = require('../services/emailService');

const normalizePaymentMethod = (method) => {
    if (!method) return null;
    const value = String(method).toLowerCase();
    if (value === 'mpesa' || value === 'm-pesa') return 'mpesa';
    if (value === 'card') return 'card';
    return null;
};

const parseDateRange = (from, to) => {
    const range = {};
    if (from) {
        const fromDate = new Date(from);
        if (!Number.isNaN(fromDate.getTime())) {
            range.$gte = fromDate;
        }
    }
    if (to) {
        const toDate = new Date(to);
        if (!Number.isNaN(toDate.getTime())) {
            range.$lte = toDate;
        }
    }
    return Object.keys(range).length ? range : null;
};

const normalizeObjectId = (value) => {
    if (!value) return null;
    const raw = String(value).trim();
    return mongoose.Types.ObjectId.isValid(raw) ? raw : null;
};

const calculateBillingMonths = (startDate, endDate) => {
    const years = endDate.getFullYear() - startDate.getFullYear();
    const months = endDate.getMonth() - startDate.getMonth();
    let totalMonths = (years * 12) + months;

    if (totalMonths <= 0) {
        totalMonths = 1;
    }

    const normalizedEnd = new Date(startDate);
    normalizedEnd.setMonth(normalizedEnd.getMonth() + totalMonths);

    if (normalizedEnd < endDate) {
        totalMonths += 1;
    }

    return Math.max(1, totalMonths);
};

const generateReceiptNumber = () => {
    return `RCP-${Date.now()}-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
};

const buildMpesaCallbackUrl = () => {
    const serverUrl = String(process.env.SERVER_URL || '').trim();
    if (!serverUrl) {
        throw new Error('SERVER_URL environment variable is required for M-Pesa callback URL.');
    }

    const webhookToken = String(
        process.env.MPESA_WEBHOOK_TOKEN
        || process.env.PAYMENT_WEBHOOK_SECRET
        || ''
    ).trim();
    if (!webhookToken) {
        throw new Error('MPESA_WEBHOOK_TOKEN (or PAYMENT_WEBHOOK_SECRET) is required for M-Pesa webhook verification.');
    }

    const callbackUrl = new URL('/api/payments/webhook/mpesa', serverUrl);
    callbackUrl.searchParams.set('token', webhookToken);
    return callbackUrl.toString();
};

const populateBookingQuery = (query) => query
    .populate('hostel', 'name location pricePerMonth images')
    .populate('owner', 'username email')
    .populate('student', 'username email');

const releaseReservedRooms = async (booking) => {
    await Hostel.findByIdAndUpdate(booking.hostel, {
        $inc: { availableRooms: booking.roomsBooked }
    });
};

const finalizePaidBooking = async (booking, reference) => {
    booking.payment.status = 'paid';
    booking.payment.reference = reference || booking.payment.reference || `PAY-${Date.now()}`;
    booking.payment.paidAt = new Date();
    booking.status = 'confirmed';

    if (!booking.receipt?.receiptNumber) {
        booking.receipt = {
            receiptNumber: generateReceiptNumber(),
            issuedAt: new Date()
        };
    }

    await booking.save();
    return booking;
};

const markBookingPaymentFailed = async (booking) => {
    const shouldReleaseRooms = booking.status !== 'cancelled' && booking.status !== 'confirmed';
    booking.payment.status = 'failed';
    if (shouldReleaseRooms) {
        booking.status = 'cancelled';
    }
    await booking.save();

    if (shouldReleaseRooms) {
        await releaseReservedRooms(booking);
    }

    return booking;
};

const withLegacyDates = (booking) => {
    if (!booking) return booking;

    const createdAt = booking.createdAt ? new Date(booking.createdAt) : new Date();
    if (!booking.startDate) {
        booking.startDate = createdAt;
    }
    if (!booking.endDate) {
        booking.endDate = new Date(createdAt.getTime() + (1000 * 60 * 60 * 24 * 30));
    }

    return booking;
};

// Create booking (Student)
exports.createBooking = async (req, res) => {
    try {
        const { hostelId, rooms = 1, paymentMethod, startDate, endDate } = req.body;
        
        if (!hostelId) {
            return res.status(400).json({ message: 'Hostel ID is required.' });
        }
        
        const roomsBooked = parseInt(rooms, 10);
        if (Number.isNaN(roomsBooked) || roomsBooked < 1) {
            return res.status(400).json({ message: 'Rooms booked must be a positive number.' });
        }
        
        const method = normalizePaymentMethod(paymentMethod);
        if (!method) {
            return res.status(400).json({ message: 'Payment method must be mpesa or card.' });
        }

        const checkIn = new Date(startDate);
        const checkOut = new Date(endDate);
        if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) {
            return res.status(400).json({ message: 'Valid startDate and endDate are required.' });
        }

        if (checkOut <= checkIn) {
            return res.status(400).json({ message: 'End date must be after start date.' });
        }
        
        // Reserve rooms (prevent overbooking) - Populating 'owner' to get email details
        const hostel = await Hostel.findOneAndUpdate(
            { 
                _id: hostelId, 
                isApproved: true, 
                isActive: true, 
                availableRooms: { $gte: roomsBooked } 
            },
            { $inc: { availableRooms: -roomsBooked } },
            { new: true }
        ).populate('owner'); 
        
        if (!hostel) {
            return res.status(409).json({ 
                message: 'Hostel unavailable or not enough rooms. Please try a different hostel or fewer rooms.' 
            });
        }

        const monthlyPrice = Number(hostel.pricePerMonth);
        if (!Number.isFinite(monthlyPrice) || monthlyPrice <= 0) {
            await Hostel.findByIdAndUpdate(hostel._id, {
                $inc: { availableRooms: roomsBooked }
            });
            return res.status(400).json({ message: 'Hostel pricing is invalid. Please contact support.' });
        }

        const billingMonths = calculateBillingMonths(checkIn, checkOut);
        const bookingAmount = monthlyPrice * roomsBooked * billingMonths;
        
        const booking = new Booking({
            hostel: hostel._id,
            student: req.user.id,
            owner: hostel.owner._id,
            roomsBooked,
            startDate: checkIn,
            endDate: checkOut,
            amount: bookingAmount,
            currency: 'KES',
            payment: {
                method,
                status: 'pending'
            }
        });
        
        let savedBooking;
        try {
            savedBooking = await booking.save();

            // --- EMAIL NOTIFICATIONS ---
            
            // 1. Notify the Owner
            if (hostel.owner && hostel.owner.email) {
                sendEmailMessage({
                    to: hostel.owner.email,
                    subject: 'New Booking Received',
                    html: `
                        <h3>New Booking for ${hostel.name}</h3>
                        <p>A student has reserved <b>${roomsBooked} room(s)</b>.</p>
                        <p><b>Dates:</b> ${checkIn.toDateString()} - ${checkOut.toDateString()}</p>
                        <p>Please review the booking in your dashboard and contact the student with further instructions.</p>
                    `
                }).catch(err => console.error('Owner email failed:', err));
            }

            // 2. Notify the Student
            if (req.user && req.user.email) {
                sendEmailMessage({
                    to: req.user.email,
                    subject: 'Booking Confirmation - Pending Payment',
                    html: `
                        <h3>Your booking for ${hostel.name} is reserved!</h3>
                        <p>You have successfully placed a booking for ${roomsBooked} room(s).</p>
                        <p><b>Note:</b> You will receive further instructions directly from the hostel owner regarding move-in details and rules.</p>
                        <p>Total Amount: KES ${bookingAmount}</p>
                    `
                }).catch(err => console.error('Student email failed:', err));
            }

        } catch (saveError) {
            await Hostel.findByIdAndUpdate(hostel._id, {
                $inc: { availableRooms: roomsBooked }
            });
            throw saveError;
        }
        
        res.status(201).json({
            message: 'Booking created. Notifications have been sent.',
            booking: savedBooking
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error.' });
    }
};

// Get a single booking (Student/Owner/Admin)
exports.getBookingById = async (req, res) => {
    try {
        const booking = await populateBookingQuery(Booking.findById(req.params.id));

        if (!booking) {
            return res.status(404).json({ message: 'Booking not found.' });
        }

        const isStudent = booking.student && booking.student._id.toString() === req.user.id;
        const isOwner = booking.owner && booking.owner._id.toString() === req.user.id;
        const isAdmin = req.user.role === 'admin';

        if (!isStudent && !isOwner && !isAdmin) {
            return res.status(403).json({ message: 'Not authorized to view this booking.' });
        }

        res.status(200).json(withLegacyDates(booking));
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Confirm payment - Student compatibility endpoint
exports.confirmPayment = async (req, res) => {
    try {
        const { phone, phoneNumber, paymentReference, paymentMethod, provider } = req.body;

        const booking = await Booking.findById(req.params.id);
        if (!booking) {
            return res.status(404).json({ message: 'Booking not found.' });
        }

        if (booking.student.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized to confirm this booking.' });
        }

        if (booking.status === 'cancelled') {
            return res.status(400).json({ message: 'Cancelled bookings cannot be confirmed.' });
        }

        if (booking.payment.status === 'paid' && booking.status === 'confirmed') {
            return res.status(200).json({ message: 'Payment already confirmed.', booking });
        }

        // Determine method (support multiple field names for compatibility)
        const selectedMethod = normalizePaymentMethod(paymentMethod || provider) || booking.payment.method;
        booking.payment.method = selectedMethod;

        // --- Handle Card Payments ---
        if (selectedMethod === 'card') {
            booking.payment.reference = paymentReference || `CARD-${Date.now()}`;
            const confirmed = await confirmAndNotify(booking);
            return res.status(200).json({
                message: 'Card payment confirmed.',
                booking: confirmed,
            });
        }

        // --- Handle M-Pesa Payments ---
        const suppliedPhone = String(phoneNumber || phone || '').trim();
        if (!suppliedPhone) {
            return res.status(400).json({ message: 'Phone number is required for M-Pesa payments.' });
        }

        // 1. Check for existing pending transactions (Idempotency)
        const latestTransaction = await PaymentTransaction.findOne({ booking: booking._id })
            .sort({ createdAt: -1 });

        if (latestTransaction && ['initiated', 'pending'].includes(latestTransaction.status)) {
            return res.status(200).json({
                stkPending: true,
                checkoutRequestID: latestTransaction.providerCheckoutId,
                message: 'M-Pesa prompt already sent. Complete payment on your phone.'
            });
        }

        // 2. Initiate STK Push
        const callbackUrl = `${process.env.SERVER_URL}/api/payments/mpesa/callback`;
        const stkResult = await initiateSTKPush(
            suppliedPhone,
            booking.amount,
            String(booking._id).slice(-12),
            callbackUrl
        );

        // 3. Record Failure
        if (!stkResult.success) {
            await PaymentTransaction.create({
                booking: booking._id,
                student: booking.student,
                owner: booking.owner,
                provider: 'mpesa',
                amount: booking.amount,
                currency: booking.currency || 'KES',
                status: 'failed',
                idempotencyKey: `failed-${Date.now()}-${booking._id}`,
                failureReason: stkResult.error,
                rawInitResponse: stkResult
            });

            return res.status(502).json({
                message: stkResult.error || 'Failed to initiate M-Pesa payment. Please try again.',
            });
        }

        // 4. Record Success & Update Booking
        booking.payment.checkoutRequestID = stkResult.checkoutRequestID;
        await booking.save();

        await PaymentTransaction.create({
            booking: booking._id,
            student: booking.student,
            owner: booking.owner,
            provider: 'mpesa',
            amount: booking.amount,
            currency: booking.currency || 'KES',
            status: 'pending',
            idempotencyKey: `stk-${Date.now()}-${booking._id}`,
            providerRequestId: stkResult.merchantRequestID,
            providerCheckoutId: stkResult.checkoutRequestID,
            rawInitResponse: stkResult
        });

        res.status(200).json({
            stkPending: true,
            checkoutRequestID: stkResult.checkoutRequestID,
            message: stkResult.customerMessage || 'Please check your phone for the M-Pesa prompt.',
        });

    } catch (error) {
        console.error('confirmPayment error:', error);
        res.status(500).json({ message: error.message || 'Server error.' });
    }
};

// Verify M-Pesa payment polling compatibility endpoint
exports.verifyMpesaPayment = async (req, res) => {
    try {
        // Populating hostel and owner to get email details for notifications
        const booking = await Booking.findById(req.params.id)
            .populate({
                path: 'hostel',
                populate: { path: 'owner' }
            })
            .populate('student');

        if (!booking) {
            return res.status(404).json({ message: 'Booking not found.' });
        }

        if (booking.student._id.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized to verify this booking payment.' });
        }

        // Helper to send success emails
        const sendSuccessEmails = async (booking) => {
            const ownerEmail = booking.hostel.owner.email;
            const studentEmail = booking.student.email;
            const hostelName = booking.hostel.name;

            // 1. Notify Owner of Payment
            if (ownerEmail) {
                sendEmailMessage({
                    to: ownerEmail,
                    subject: `Payment Confirmed: ${hostelName}`,
                    html: `
                        <h3>Payment Received!</h3>
                        <p>The payment for the booking at <b>${hostelName}</b> has been successfully verified.</p>
                        <p><b>Amount:</b> KES ${booking.amount}</p>
                        <p><b>Reference:</b> ${booking.payment.providerReference || 'M-Pesa'}</p>
                        <p>Please prepare for the student's arrival as per the booking dates.</p>
                    `
                }).catch(err => console.error('Owner payment email failed:', err));
            }

            // 2. Notify Student of Confirmation
            if (studentEmail) {
                sendEmailMessage({
                    to: studentEmail,
                    subject: `Payment Successful - ${hostelName}`,
                    html: `
                        <h3>Your payment was successful!</h3>
                        <p>Your booking at <b>${hostelName}</b> is now fully confirmed.</p>
                        <p><b>Next Steps:</b> The owner has been notified. You can now reach out to them for move-in instructions if they haven't contacted you yet.</p>
                        <p>Thank you for using SmartHostelFinder!</p>
                    `
                }).catch(err => console.error('Student payment email failed:', err));
            }
        };

        if (booking.payment.status === 'paid' && booking.status === 'confirmed') {
            return res.status(200).json({ confirmed: true, booking: withLegacyDates(booking) });
        }

        const latestTransaction = await PaymentTransaction.findOne({
            booking: booking._id,
            provider: 'mpesa'
        }).sort({ createdAt: -1 });

        if (!latestTransaction) {
            return res.status(404).json({ failed: true, message: 'No M-Pesa payment transaction found for this booking.' });
        }

        // CASE 1: Transaction already marked as succeeded in DB
        if (latestTransaction.status === 'succeeded') {
            await finalizePaidBooking(
                booking,
                latestTransaction.providerReference || latestTransaction.providerTransactionId || latestTransaction.providerRequestId
            );
            
            await sendSuccessEmails(booking); // Trigger Emails

            return res.status(200).json({ confirmed: true, booking: withLegacyDates(booking) });
        }

        // CASE 2: Transaction clearly failed
        if (['failed', 'cancelled', 'timeout'].includes(latestTransaction.status)) {
            await markBookingPaymentFailed(booking);
            return res.status(200).json({
                failed: true,
                message: latestTransaction.failureReason || 'Payment was not completed.'
            });
        }

        if (!latestTransaction.providerCheckoutId) {
            return res.status(200).json({ pending: true, message: 'Payment is still pending.' });
        }

        // CASE 3: Query M-Pesa API for status
        const stkStatus = await querySTKStatus(latestTransaction.providerCheckoutId);
        if (!stkStatus.success) {
            return res.status(200).json({ pending: true, message: 'Still waiting for payment confirmation.' });
        }

        // Payment Success from API
        if (stkStatus.resultCode === '0') {
            latestTransaction.status = 'succeeded';
            latestTransaction.providerReference = latestTransaction.providerReference || latestTransaction.providerTransactionId;
            latestTransaction.rawCallback = stkStatus;
            await latestTransaction.save();

            await finalizePaidBooking(
                booking,
                latestTransaction.providerReference || latestTransaction.providerTransactionId || latestTransaction.providerRequestId
            );

            await sendSuccessEmails(booking); // Trigger Emails

            return res.status(200).json({ confirmed: true, booking });
        }

        // Payment Failed from API
        if (['1032', '1037', '1', '2001'].includes(String(stkStatus.resultCode))) {
            latestTransaction.status = ['1037'].includes(String(stkStatus.resultCode)) ? 'timeout' : 'failed';
            latestTransaction.failureCode = String(stkStatus.resultCode);
            latestTransaction.failureReason = stkStatus.resultDesc;
            latestTransaction.rawCallback = stkStatus;
            await latestTransaction.save();
            await markBookingPaymentFailed(booking);

            return res.status(200).json({
                failed: true,
                message: stkStatus.resultDesc || 'Payment failed.'
            });
        }

        return res.status(200).json({
            pending: true,
            message: stkStatus.resultDesc || 'Payment is still pending.'
        });
    } catch (error) {
        res.status(500).json({ message: error.message || 'Server error.' });
    }
};

// Cancel booking (Student)
exports.cancelBooking = async (req, res) => {
    try {
        // Populating to get owner email and hostel name for the notification
        const booking = await Booking.findById(req.params.id)
            .populate({
                path: 'hostel',
                populate: { path: 'owner' }
            })
            .populate('student');

        if (!booking) {
            return res.status(404).json({ message: 'Booking not found.' });
        }
        
        if (booking.student._id.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized to cancel this booking.' });
        }
        
        if (booking.status === 'cancelled') {
            return res.status(400).json({ message: 'Booking is already cancelled.' });
        }
        
        booking.status = 'cancelled';
        await booking.save();
        
        // Release rooms back to the hostel inventory
        await releaseReservedRooms(booking);

        // --- EMAIL NOTIFICATIONS ---
        const hostelName = booking.hostel.name;
        const ownerEmail = booking.hostel.owner.email;
        const studentEmail = booking.student.email;

        // 1. Notify the Owner that a booking was cancelled
        if (ownerEmail) {
            sendEmailMessage({
                to: ownerEmail,
                subject: `Booking Cancelled: ${hostelName}`,
                html: `
                    <h3>Cancellation Notice</h3>
                    <p>Hello,</p>
                    <p>The booking for <b>${hostelName}</b> (Ref: ${booking._id}) has been cancelled by the student.</p>
                    <p>The <b>${booking.roomsBooked} room(s)</b> have been released back into your available inventory.</p>
                `
            }).catch(err => console.error('Owner cancellation email failed:', err));
        }

        // 2. Notify the Student confirming their cancellation
        if (studentEmail) {
            sendEmailMessage({
                to: studentEmail,
                subject: `Booking Cancelled Successfully`,
                html: `
                    <h3>Your cancellation is confirmed</h3>
                    <p>Your booking at <b>${hostelName}</b> has been successfully cancelled.</p>
                    <p>If you have already made a payment, please contact support regarding the refund policy.</p>
                    <p>We hope to help you find another stay soon!</p>
                `
            }).catch(err => console.error('Student cancellation email failed:', err));
        }
        
        res.status(200).json({ message: 'Booking cancelled successfully and notifications sent.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error.' });
    }
};

// Owner: release unpaid reservation and free rooms
exports.releasePendingBookingByOwner = async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id)
            .populate('hostel', 'name');

        if (!booking) {
            return res.status(404).json({ message: 'Booking not found.' });
        }

        if (booking.owner.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized to release this booking.' });
        }

        if (booking.status === 'confirmed' || booking.payment?.status === 'paid') {
            return res.status(400).json({ message: 'Paid or confirmed bookings cannot be released by the owner.' });
        }

        if (booking.status === 'cancelled') {
            return res.status(400).json({ message: 'Booking is already cancelled.' });
        }

        booking.status = 'cancelled';
        booking.payment.status = 'failed';
        await booking.save();

        await PaymentTransaction.updateMany(
            {
                booking: booking._id,
                status: { $in: ['initiated', 'pending'] }
            },
            {
                $set: {
                    status: 'cancelled',
                    failureReason: 'Booking released by hostel owner.'
                }
            }
        );

        await releaseReservedRooms(booking);

        res.status(200).json({
            message: `Booking released and ${booking.roomsBooked} room${booking.roomsBooked > 1 ? 's were' : ' was'} returned to availability.`,
            booking: withLegacyDates(booking)
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// List bookings for current student
exports.listMyBookings = async (req, res) => {
    try {
        const bookings = await Booking.find({ student: req.user.id })
            .populate('hostel', 'name location pricePerMonth images')
            .sort({ createdAt: -1 });
        
        res.status(200).json(bookings.map(withLegacyDates));
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// List bookings for owner (hostels they own)
exports.listOwnerBookings = async (req, res) => {
    try {
        const bookings = await Booking.find({ owner: req.user.id })
            .populate('hostel', 'name location pricePerMonth images')
            .populate('student', 'username email')
            .sort({ createdAt: -1 });
        
        res.status(200).json(bookings.map(withLegacyDates));
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Admin: list bookings with filters
exports.listAdminBookings = async (req, res) => {
    try {
        const { status, owner, hostel, dateFrom, dateTo, page = 1, limit = 20 } = req.query;
        const query = {};

        if (status) {
            query.status = status;
        }

        const ownerId = normalizeObjectId(owner);
        if (owner && !ownerId) {
            return res.status(400).json({ message: 'Invalid owner id.' });
        }
        if (ownerId) {
            query.owner = ownerId;
        }

        const hostelId = normalizeObjectId(hostel);
        if (hostel && !hostelId) {
            return res.status(400).json({ message: 'Invalid hostel id.' });
        }
        if (hostelId) {
            query.hostel = hostelId;
        }

        const dateRange = parseDateRange(dateFrom, dateTo);
        if (dateRange) {
            query.createdAt = dateRange;
        }

        const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
        const limitNumber = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

        const [bookings, total] = await Promise.all([
            Booking.find(query)
                .populate('hostel', 'name location pricePerMonth')
                .populate('owner', 'username email')
                .populate('student', 'username email')
                .sort({ createdAt: -1 })
                .skip((pageNumber - 1) * limitNumber)
                .limit(limitNumber),
            Booking.countDocuments(query)
        ]);

        res.status(200).json({
            bookings: bookings.map(withLegacyDates),
            total,
            totalPages: Math.ceil(total / limitNumber),
            currentPage: pageNumber
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Download receipt PDF (Student/Owner/Admin)
exports.downloadReceipt = async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id)
            .populate('hostel', 'name location pricePerMonth')
            .populate('owner', 'username email')
            .populate('student', 'username email');
        withLegacyDates(booking);

        if (!booking) {
            return res.status(404).json({ message: 'Booking not found.' });
        }

        const isStudent = booking.student && booking.student._id.toString() === req.user.id;
        const isOwner = booking.owner && booking.owner._id.toString() === req.user.id;
        const isAdmin = req.user.role === 'admin';

        if (!isStudent && !isOwner && !isAdmin) {
            return res.status(403).json({ message: 'Not authorized to access this receipt.' });
        }

        if (booking.status !== 'confirmed' || booking.payment.status !== 'paid') {
            return res.status(400).json({ message: 'Receipt available only for confirmed, paid bookings.' });
        }

        const filename = `receipt-${booking.receipt?.receiptNumber || booking._id}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        doc.pipe(res);

        doc.fontSize(20).text('SmartHostelFinder Receipt', { align: 'center' });
        doc.moveDown();

        doc.fontSize(12).text(`Receipt No: ${booking.receipt?.receiptNumber || 'N/A'}`);
        doc.text(`Issued At: ${booking.receipt?.issuedAt ? new Date(booking.receipt.issuedAt).toLocaleString() : 'N/A'}`);
        doc.moveDown();

        doc.fontSize(14).text('Booking Details');
        doc.fontSize(12).text(`Booking ID: ${booking._id}`);
        doc.text(`Status: ${booking.status}`);
        doc.text(`Rooms Booked: ${booking.roomsBooked}`);
        doc.text(`Check-in: ${booking.startDate ? new Date(booking.startDate).toLocaleDateString() : 'N/A'}`);
        doc.text(`Check-out: ${booking.endDate ? new Date(booking.endDate).toLocaleDateString() : 'N/A'}`);
        doc.text(`Amount Paid: ${booking.amount} ${booking.currency}`);
        doc.text(`Payment Method: ${booking.payment.method}`);
        doc.text(`Payment Reference: ${booking.payment.reference || 'N/A'}`);
        doc.moveDown();

        doc.fontSize(14).text('Hostel');
        doc.fontSize(12).text(`Name: ${booking.hostel?.name || 'N/A'}`);
        doc.text(`City: ${booking.hostel?.location?.city || 'N/A'}`);
        doc.text(`Address: ${booking.hostel?.location?.address || 'N/A'}`);
        doc.moveDown();

        doc.fontSize(14).text('Student');
        doc.fontSize(12).text(`Name: ${booking.student?.username || 'N/A'}`);
        doc.text(`Email: ${booking.student?.email || 'N/A'}`);
        doc.moveDown();

        doc.fontSize(14).text('Owner');
        doc.fontSize(12).text(`Name: ${booking.owner?.username || 'N/A'}`);
        doc.text(`Email: ${booking.owner?.email || 'N/A'}`);

        doc.end();
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};
