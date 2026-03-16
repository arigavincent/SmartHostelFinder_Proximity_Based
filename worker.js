const dotenv = require('dotenv');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const { validateEnv } = require('./config/env');
const { logger } = require('./helpers/logger');
const { startJobWorker, stopJobWorker } = require('./services/jobQueueService');

dotenv.config();
validateEnv();

const startWorker = async () => {
    try {
        await connectDB();
        startJobWorker();
        logger.info('worker.started', {
            environment: process.env.NODE_ENV || 'development'
        });
    } catch (error) {
        logger.error('worker.start_failed', { error: error.message });
        process.exit(1);
    }
};

const shutdown = async (signal) => {
    logger.warn('worker.shutdown_started', { signal });
    stopJobWorker();
    try {
        await mongoose.connection.close(false);
    } catch (error) {
        logger.error('worker.shutdown_db_error', { error: error.message });
    }
    logger.warn('worker.shutdown_completed', { signal });
    process.exit(0);
};

['SIGINT', 'SIGTERM'].forEach((signal) => {
    process.on(signal, () => {
        void shutdown(signal);
    });
});

startWorker();
