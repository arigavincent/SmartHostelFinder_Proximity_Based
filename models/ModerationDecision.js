const mongoose = require('mongoose');

const ModerationDecisionSchema = new mongoose.Schema({
    contentType: {
        type: String,
        enum: ['listing', 'review'],
        required: true
    },
    contentId: { type: String, required: true, index: true },
    status: {
        type: String,
        enum: ['flagged', 'pending', 'approved', 'removed'],
        required: true
    },
    reason: { type: String, trim: true },
    actionedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }
}, { timestamps: true });

ModerationDecisionSchema.index({ contentType: 1, contentId: 1 }, { unique: true });

module.exports = mongoose.model('ModerationDecision', ModerationDecisionSchema);
