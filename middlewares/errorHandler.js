const multer = require('multer');
const { logger } = require('../helpers/logger');

const notFoundHandler = (req, res) => {
    res.status(404).json({
        message: 'Route not found',
        requestId: req.requestId
    });
};

const errorHandler = (err, req, res, next) => {
    let statusCode = Number(err.statusCode || err.status || 500);
    let message = err.message || 'Internal server error';

    if (err instanceof multer.MulterError) {
        statusCode = 400;

        if (err.code === 'LIMIT_FILE_SIZE') {
            message = 'Upload failed: each file must be 5MB or smaller.';
        } else if (err.code === 'LIMIT_FILE_COUNT') {
            message = 'Upload failed: too many files were selected.';
        } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            message = 'Upload failed: unexpected file field.';
        } else if (err.code === 'LIMIT_PART_COUNT' || err.code === 'LIMIT_FIELD_COUNT') {
            message = 'Upload failed: too many form fields were submitted.';
        } else {
            message = `Upload failed: ${err.message}`;
        }
    }

    const isServerError = statusCode >= 500;

    logger.error('request.failed', {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode,
        error: message,
        stack: err.stack
    });

    if (res.headersSent) {
        return next(err);
    }

    res.status(statusCode).json({
        message: isServerError ? 'Internal server error' : message,
        requestId: req.requestId
    });
};

module.exports = { notFoundHandler, errorHandler };
