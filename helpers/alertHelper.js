const axios = require('axios');
const { logger } = require('./logger');

const sendAlert = async ({ event, severity = 'error', message, metadata = {} }) => {
    const webhookUrl = String(process.env.ALERT_WEBHOOK_URL || '').trim();
    if (!webhookUrl) return false;

    try {
        await axios.post(webhookUrl, {
            service: 'smarthostelfinder-backend',
            environment: process.env.NODE_ENV || 'development',
            event,
            severity,
            message,
            metadata,
            timestamp: new Date().toISOString()
        }, {
            timeout: 5000
        });
        return true;
    } catch (error) {
        logger.warn('alert.delivery_failed', {
            event,
            error: error.message
        });
        return false;
    }
};

module.exports = { sendAlert };
