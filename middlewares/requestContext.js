const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const { logger } = require('../helpers/logger');

const requestContextStore = new AsyncLocalStorage();

const firstHeaderValue = (value) => String(value || '')
    .split(',')
    .map((item) => item.trim())
    .find(Boolean) || '';

const buildRequestOrigin = (req) => {
    const forwardedProto = firstHeaderValue(req.headers['x-forwarded-proto']);
    const forwardedHost = firstHeaderValue(req.headers['x-forwarded-host']);
    const protocol = forwardedProto || req.protocol || 'http';
    const host = forwardedHost || req.get('host') || '';

    return host ? `${protocol}://${host}` : '';
};

const getRequestContext = () => requestContextStore.getStore() || null;

const requestContext = (req, res, next) => {
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();
    const startedAt = Date.now();
    const context = {
        requestId,
        origin: buildRequestOrigin(req)
    };

    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    requestContextStore.run(context, () => {
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
    });
};

module.exports = { requestContext, getRequestContext };
