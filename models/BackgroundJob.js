const mongoose = require('mongoose');

const BackgroundJobSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['email', 'bulk_import', 'bulk_export'],
        required: true,
        index: true
    },
    status: {
        type: String,
        enum: ['pending', 'running', 'retry', 'completed', 'failed'],
        default: 'pending',
        index: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'createdByModel'
    },
    createdByModel: {
        type: String,
        enum: ['Admin', 'Student', 'Owner']
    },
    payload: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    result: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    attempts: {
        type: Number,
        default: 0,
        min: 0
    },
    maxAttempts: {
        type: Number,
        default: 3,
        min: 1
    },
    priority: {
        type: Number,
        default: 10,
        min: 1,
        max: 100
    },
    runAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    lockedAt: { type: Date },
    startedAt: { type: Date },
    completedAt: { type: Date },
    failedAt: { type: Date },
    errorMessage: { type: String, trim: true },
    errorDetails: { type: mongoose.Schema.Types.Mixed }
}, { timestamps: true });

BackgroundJobSchema.index({ status: 1, runAt: 1, priority: 1, createdAt: 1 });

module.exports = mongoose.model('BackgroundJob', BackgroundJobSchema);
