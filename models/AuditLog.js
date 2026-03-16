const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
    actorAdmin: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    actorEmail: { type: String, trim: true },
    action: { type: String, required: true, trim: true },
    target: { type: String, required: true, trim: true },
    type: { type: String, required: true, trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed }
}, { timestamps: true });

module.exports = mongoose.model('AuditLog', AuditLogSchema);
