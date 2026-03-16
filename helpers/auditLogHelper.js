const AuditLog = require('../models/AuditLog');

const logAdminAction = async ({ adminId, adminEmail, action, target, type, metadata = {} }) => {
    try {
        await AuditLog.create({
            actorAdmin: adminId,
            actorEmail: adminEmail,
            action,
            target,
            type,
            metadata
        });
    } catch (error) {
        console.error('Failed to persist audit log:', error.message);
    }
};

module.exports = { logAdminAction };
