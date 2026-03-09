const mongoose = require('mongoose');

const BookingSchema = new mongoose.Schema({
    hostel: { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel', required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', required: true },
    roomsBooked: { type: Number, required: true, min: 1, default: 1 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'KES' },
    status: { 
        type: String, 
        enum: ['pending_payment', 'confirmed', 'cancelled'], 
        default: 'pending_payment' 
    },
    payment: {
        method: { type: String, enum: ['mpesa', 'card'], required: true },
        status: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
        reference: { type: String },
        paidAt: { type: Date },
        checkoutRequestID: { type: String },
    },
    receipt: {
        receiptNumber: { type: String },
        issuedAt: { type: Date }
    }
}, { timestamps: true });

module.exports = mongoose.model('Booking', BookingSchema);
