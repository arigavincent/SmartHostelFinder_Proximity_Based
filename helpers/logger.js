const formatLog = (level, message, metadata = {}) => JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...metadata
});

const logger = {
    info(message, metadata) {
        console.log(formatLog('info', message, metadata));
    },
    warn(message, metadata) {
        console.warn(formatLog('warn', message, metadata));
    },
    error(message, metadata) {
        console.error(formatLog('error', message, metadata));
    }
};

module.exports = { logger };
