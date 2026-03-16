const crypto = require('crypto');
const { logger } = require('../helpers/logger');

const requestContext = (req, res, next) => {
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();
    const startedAt = Date.now();

    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    res.on('finish', () => {
        logger.info('request.completed', {
            requestId,
            method: req.method,
            path: req.originalUrl,
            statusCode: res.statusCode,
            durationMs: Date.now() - startedAt,
            ip: req.ip
        });
    });

    next();
};

module.exports = { requestContext };
