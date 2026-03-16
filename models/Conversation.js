const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
    sender: {
        type: String,
        enum: ['owner', 'tenant'],
        required: true
    },
    text: { type: String, required: true, trim: true },
    createdAt: { type: Date, default: Date.now }
}, { _id: true });

const ConversationSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', required: true, index: true },
    hostel: { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel' },
    tenantName: { type: String, required: true, trim: true },
    tenantPhone: { type: String, trim: true },
    tenantEmail: { type: String, trim: true },
    unreadCountOwner: { type: Number, default: 0, min: 0 },
    messages: { type: [MessageSchema], default: [] },
    lastMessageAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Conversation', ConversationSchema);
