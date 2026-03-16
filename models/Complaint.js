const mongoose = require('mongoose');

const ComplaintSchema = new mongoose.Schema({
    subject: { type: String, required: true, trim: true },
    studentName: { type: String, required: true, trim: true },
    ownerName: { type: String, required: true, trim: true },
    hostelName: { type: String, required: true, trim: true },
    details: { type: String, trim: true },
    priority: {
        type: String,
        enum: ['high', 'medium', 'low'],
        default: 'medium'
    },
    status: {
        type: String,
        enum: ['open', 'investigating', 'resolved'],
        default: 'open'
    },
    notes: { type: String, trim: true }
}, { timestamps: true });

module.exports = mongoose.model('Complaint', ComplaintSchema);
