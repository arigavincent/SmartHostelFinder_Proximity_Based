const mongoose = require('mongoose');

const MaintenanceRequestSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', required: true, index: true },
    hostel: { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
    tenantName: { type: String, required: true, trim: true },
    tenantPhone: { type: String, trim: true },
    roomLabel: { type: String, trim: true },
    category: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    priority: {
        type: String,
        enum: ['urgent', 'high', 'medium', 'low'],
        default: 'medium'
    },
    status: {
        type: String,
        enum: ['open', 'in_progress', 'resolved'],
        default: 'open'
    },
    assignedTo: { type: String, trim: true },
    resolvedAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('MaintenanceRequest', MaintenanceRequestSchema);
