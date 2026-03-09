const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const Booking = require('../models/Booking');
const Hostel = require('../models/Hostel');
const { initiateSTKPush, querySTKStatus } = require('../utils/mpesa');
const { sendBookingConfirmationEmail } = require('../helpers/emailHelper');

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

// Create booking (Student)
exports.createBooking = async (req, res) => {
    try {
        const { hostelId, rooms = 1, paymentMethod, startDate, endDate } = req.body;
        
        if (!hostelId) {
            return res.status(400).json({ message: 'Hostel ID is required.' });
        }

        // Validate dates
        if (!startDate || !endDate) {
            return res.status(400).json({ message: 'Start date and end date are required.' });
        }
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({ message: 'Invalid date format provided.' });
        }
        if (start >= end) {
            return res.status(400).json({ message: 'End date must be after start date.' });
        }
        // Allow today or future dates only
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (start < today) {
            return res.status(400).json({ message: 'Start date cannot be in the past.' });
        }
        
        const roomsBooked = parseInt(rooms, 10);
        if (Number.isNaN(roomsBooked) || roomsBooked < 1) {
            return res.status(400).json({ message: 'Rooms booked must be a positive number.' });
        }
        
        const method = normalizePaymentMethod(paymentMethod);
        if (!method) {
            return res.status(400).json({ message: 'Payment method must be mpesa or card.' });
        }
        
        // Reserve rooms (prevent overbooking)
        const hostel = await Hostel.findOneAndUpdate(
            { 
                _id: hostelId, 
                isApproved: true, 
                isActive: true, 
                availableRooms: { $gte: roomsBooked } 
            },
            { $inc: { availableRooms: -roomsBooked } },
            { new: true }
        );
        
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

        // Calculate amount based on duration
        // 1 month = 30 days; round up to nearest month
        const diffMs = end.getTime() - start.getTime();
        const months = Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 30));
        const bookingAmount = monthlyPrice * roomsBooked * months;
        
        const booking = new Booking({
            hostel: hostel._id,
            student: req.user.id,
            owner: hostel.owner,
            roomsBooked,
            startDate: start,
            endDate: end,
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
        } catch (saveError) {
            await Hostel.findByIdAndUpdate(hostel._id, {
                $inc: { availableRooms: roomsBooked }
            });
            throw saveError;
        }
        
        res.status(201).json({
            message: 'Booking created. Pending payment confirmation.',
            booking: savedBooking
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Helper: confirm a booking and send confirmation email
async function confirmAndNotify(booking) {
    const receiptNumber = `RCP-${Date.now()}-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
    booking.payment.status = 'paid';
    booking.payment.paidAt = new Date();
    booking.status = 'confirmed';
    booking.receipt = { receiptNumber, issuedAt: new Date() };
    await booking.save();

    // Send confirmation email (non-blocking)
    try {
        const populatedBooking = await Booking.findById(booking._id)
            .populate('hostel', 'name location')
            .populate('student', 'username email');
        if (populatedBooking?.student?.email) {
            sendBookingConfirmationEmail(
                populatedBooking.student.email,
                populatedBooking.student.username,
                {
                    hostelName: populatedBooking.hostel?.name || 'N/A',
                    hostelAddress: populatedBooking.hostel?.location?.address || populatedBooking.hostel?.location?.city || '',
                    startDate: populatedBooking.startDate,
                    endDate: populatedBooking.endDate,
                    roomsBooked: populatedBooking.roomsBooked,
                    amount: populatedBooking.amount,
                    currency: populatedBooking.currency,
                    paymentMethod: populatedBooking.payment.method,
                    paymentReference: populatedBooking.payment.reference || '',
                    receiptNumber,
                }
            ).catch((e) => console.error('Confirmation email error:', e.message));
        }
    } catch (e) {
        console.error('Email send error:', e.message);
    }

    return booking;
}

// Confirm payment - Student
exports.confirmPayment = async (req, res) => {
    try {
        const { phone, paymentReference } = req.body;

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

        // M-Pesa: initiate STK push
        if (booking.payment.method === 'mpesa') {
            if (!phone) {
                return res.status(400).json({ message: 'Phone number is required for M-Pesa payment.' });
            }
            const callbackUrl = `${process.env.SERVER_URL}/api/payments/mpesa/callback`;
            const stkResult = await initiateSTKPush(
                phone,
                booking.amount,
                String(booking._id).slice(-12),
                callbackUrl
            );

            if (!stkResult.success) {
                return res.status(502).json({
                    message: stkResult.error || 'Failed to initiate M-Pesa payment. Please try again.',
                });
            }

            // Store checkoutRequestID for status polling
            booking.payment.checkoutRequestID = stkResult.checkoutRequestID;
            await booking.save();

            return res.status(200).json({
                stkPending: true,
                checkoutRequestID: stkResult.checkoutRequestID,
                message: stkResult.customerMessage || 'Please check your phone for the M-Pesa prompt and enter your PIN.',
            });
        }

        // Card: confirm immediately (mock/placeholder)
        booking.payment.reference = paymentReference || `CARD-${Date.now()}`;
        const confirmed = await confirmAndNotify(booking);

        res.status(200).json({
            message: 'Payment confirmed.',
            booking: confirmed,
        });
    } catch (error) {
        console.error('confirmPayment error:', error);
        res.status(500).json({ message: 'Server error.' });
    }
};

// Verify M-Pesa STK status (polling endpoint) - Student
exports.verifyMpesaPayment = async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id);
        if (!booking) {
            return res.status(404).json({ message: 'Booking not found.' });
        }

        if (booking.student.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized.' });
        }

        if (booking.payment.status === 'paid' && booking.status === 'confirmed') {
            return res.status(200).json({ confirmed: true, booking });
        }

        const checkoutRequestID = booking.payment.checkoutRequestID;
        if (!checkoutRequestID) {
            return res.status(400).json({ message: 'No pending M-Pesa transaction for this booking.' });
        }

        const statusResult = await querySTKStatus(checkoutRequestID);

        if (!statusResult.success) {
            // Could be still processing — treat as pending
            return res.status(200).json({ pending: true, message: 'Still waiting for payment confirmation.' });
        }

        const resultCode = String(statusResult.resultCode);

        if (resultCode === '0') {
            // Payment successful
            const mpesaRef = `MPESA-${checkoutRequestID.slice(-8)}`;
            booking.payment.reference = mpesaRef;
            const confirmed = await confirmAndNotify(booking);
            return res.status(200).json({ confirmed: true, booking: confirmed });
        }

        if (resultCode === '1032') {
            // User cancelled
            booking.payment.status = 'failed';
            await booking.save();
            return res.status(200).json({ failed: true, message: 'Payment was cancelled. Please try again.' });
        }

        if (resultCode === '1037') {
            // Request timed out on M-Pesa side
            booking.payment.status = 'failed';
            await booking.save();
            return res.status(200).json({ failed: true, message: 'M-Pesa request timed out. Please try again.' });
        }

        // Other non-zero codes = still pending or unknown
        return res.status(200).json({ pending: true, message: statusResult.resultDesc || 'Payment still processing.' });
    } catch (error) {
        console.error('verifyMpesaPayment error:', error);
        res.status(500).json({ message: 'Server error.' });
    }
};

// Cancel booking (Student)
exports.cancelBooking = async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id);
        if (!booking) {
            return res.status(404).json({ message: 'Booking not found.' });
        }
        
        if (booking.student.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized to cancel this booking.' });
        }
        
        if (booking.status === 'cancelled') {
            return res.status(400).json({ message: 'Booking is already cancelled.' });
        }
        
        booking.status = 'cancelled';
        await booking.save();
        
        // Release rooms
        await Hostel.findByIdAndUpdate(booking.hostel, {
            $inc: { availableRooms: booking.roomsBooked }
        });
        
        res.status(200).json({ message: 'Booking cancelled successfully.' });
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
        
        res.status(200).json(bookings);
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// List bookings for owner (hostels they own)
exports.listOwnerBookings = async (req, res) => {
    try {
        const bookings = await Booking.find({ owner: req.user.id })
            .populate('hostel', 'name location pricePerMonth')
            .populate('student', 'username email')
            .sort({ createdAt: -1 });
        
        res.status(200).json(bookings);
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
            bookings,
            total,
            totalPages: Math.ceil(total / limitNumber),
            currentPage: pageNumber
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Get single booking by ID (Student/Owner/Admin)
exports.getBookingById = async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id)
            .populate('hostel', 'name location pricePerMonth')
            .populate('owner', 'username email')
            .populate('student', 'username email');

        if (!booking) {
            return res.status(404).json({ message: 'Booking not found.' });
        }

        const isStudent = booking.student?._id.toString() === req.user.id;
        const isOwner = booking.owner?._id.toString() === req.user.id;
        const isAdmin = req.user.role === 'admin';

        if (!isStudent && !isOwner && !isAdmin) {
            return res.status(403).json({ message: 'Not authorized.' });
        }

        res.status(200).json(booking);
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
