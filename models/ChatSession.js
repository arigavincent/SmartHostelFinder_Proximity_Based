const mongoose = require('mongoose');

const ChatSessionMessageSchema = new mongoose.Schema({
    role: {
        type: String,
        enum: ['user', 'assistant'],
        required: true
    },
    content: { type: String, required: true, trim: true },
    createdAt: { type: Date, default: Date.now }
}, { _id: true });

const ChatSessionSchema = new mongoose.Schema({
    userRole: {
        type: String,
        enum: ['guest', 'student', 'owner', 'admin'],
        default: 'guest',
        index: true
    },
    userId: { type: String, trim: true, index: true },
    sessionTitle: { type: String, trim: true },
    messages: { type: [ChatSessionMessageSchema], default: [] },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

module.exports = mongoose.model('ChatSession', ChatSessionSchema);
