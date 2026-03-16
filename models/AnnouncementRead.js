const mongoose = require('mongoose');

const AnnouncementReadSchema = new mongoose.Schema({
    announcement: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Announcement',
        required: true,
        index: true
    },
    userRole: {
        type: String,
        enum: ['student', 'owner'],
        required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true
    },
    readAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

AnnouncementReadSchema.index({ announcement: 1, userRole: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('AnnouncementRead', AnnouncementReadSchema);
