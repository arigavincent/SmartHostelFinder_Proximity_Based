const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const Booking = require('../models/Booking');
const Hostel = require('../models/Hostel');

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
        const { hostelId, rooms = 1, paymentMethod } = req.body;
        
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

        const bookingAmount = monthlyPrice * roomsBooked;
        
        const booking = new Booking({
            hostel: hostel._id,
            student: req.user.id,
            owner: hostel.owner,
            roomsBooked,
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

// Confirm payment (mock) - Student
exports.confirmPayment = async (req, res) => {
    try {
        const { paymentReference } = req.body;
        
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
        
        const receiptNumber = `RCP-${Date.now()}-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
        
        booking.payment.status = 'paid';
        booking.payment.reference = paymentReference || booking.payment.reference || `MOCK-${Date.now()}`;
        booking.payment.paidAt = new Date();
        booking.status = 'confirmed';
        booking.receipt = { receiptNumber, issuedAt: new Date() };
        
        await booking.save();
        
        res.status(200).json({
            message: 'Payment confirmed (mock).',
            booking
        });
    } catch (error) {
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
