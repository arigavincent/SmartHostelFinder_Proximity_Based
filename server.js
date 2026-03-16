const dotenv = require('dotenv');
const connectDB = require('./config/db');
const cron = require('node-cron');
const axios = require('axios');
const { validateEnv } = require('./config/env');
const { logger } = require('./helpers/logger');
const { createApp } = require('./app');
const { startJobWorker, stopJobWorker } = require('./services/jobQueueService');

dotenv.config();

const env = validateEnv();
const app = createApp(env);
let httpServer;

const startServer = async () => {
    try {
        await connectDB();
        if (env.jobWorkerInline) {
            startJobWorker();
            logger.info('worker.inline_started', {
                intervalMs: env.jobPollIntervalMs,
                concurrency: env.jobConcurrency
            });
        }
        httpServer = app.listen(env.port, () => {
            logger.info('server.started', {
                port: env.port,
                environment: env.nodeEnv
            });
        });

        const keepAliveUrl = String(process.env.SERVER_URL || '').trim() || `http://localhost:${env.port}`;
        cron.schedule('*/3 * * * *', async () => {
            try {
                const response = await axios.get(`${keepAliveUrl}/api/health`);
                logger.info('cron.keepalive_success', { status: response.data?.status || 'OK' });
            } catch (error) {
                logger.warn('cron.keepalive_failed', { error: error.message });
            }
        });
    } catch (error) {
        logger.error('server.start_failed', { error: error.message });
        process.exit(1);
    }
};

const shutdown = async (signal) => {
    logger.warn('server.shutdown_started', { signal });
    stopJobWorker();

    if (httpServer) {
        await new Promise((resolve) => httpServer.close(resolve));
    }

    try {
        const mongoose = require('mongoose');
        await mongoose.connection.close(false);
    } catch (error) {
        logger.error('server.shutdown_db_error', { error: error.message });
    }

    logger.warn('server.shutdown_completed', { signal });
    process.exit(0);
};

['SIGINT', 'SIGTERM'].forEach((signal) => {
    process.on(signal, () => {
        void shutdown(signal);
    });
});

process.on('unhandledRejection', (error) => {
    logger.error('process.unhandled_rejection', { error: error instanceof Error ? error.message : String(error) });
});

process.on('uncaughtException', (error) => {
    logger.error('process.uncaught_exception', { error: error.message, stack: error.stack });
    process.exit(1);
});

startServer();
