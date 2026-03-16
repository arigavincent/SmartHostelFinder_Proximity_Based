const mongoose = require('mongoose');

const AnnouncementSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    audience: {
        type: String,
        enum: ['all', 'students', 'owners'],
        default: 'all'
    },
    status: {
        type: String,
        enum: ['draft', 'sent'],
        default: 'draft'
    },
    publishedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
    viewCount: { type: Number, default: 0, min: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Announcement', AnnouncementSchema);
