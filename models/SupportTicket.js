const mongoose = require('mongoose');

const SupportTicketReplySchema = new mongoose.Schema({
    sender: {
        type: String,
        enum: ['user', 'admin'],
        required: true
    },
    message: { type: String, required: true, trim: true },
    createdAt: { type: Date, default: Date.now }
}, { _id: true });

const SupportTicketSchema = new mongoose.Schema({
    subject: { type: String, required: true, trim: true },
    userEmail: { type: String, required: true, trim: true },
    userRole: {
        type: String,
        enum: ['Student', 'Owner', 'Admin'],
        required: true
    },
    priority: {
        type: String,
        enum: ['high', 'medium', 'low'],
        default: 'medium'
    },
    status: {
        type: String,
        enum: ['open', 'in_progress', 'resolved'],
        default: 'open'
    },
    replies: { type: [SupportTicketReplySchema], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('SupportTicket', SupportTicketSchema);
