const mongoose = require('mongoose');

const BulkImportJobSchema = new mongoose.Schema({
    dataType: {
        type: String,
        enum: ['users', 'hostels', 'bookings'],
        required: true
    },
    fileName: { type: String, trim: true },
    status: {
        type: String,
        enum: ['completed', 'failed'],
        default: 'completed'
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
    summary: {
        created: { type: Number, default: 0, min: 0 },
        skipped: { type: Number, default: 0, min: 0 },
        failed: { type: Number, default: 0, min: 0 }
    },
    errorMessages: { type: [String], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('BulkImportJob', BulkImportJobSchema);
