const BackgroundJob = require('../models/BackgroundJob');
const { logger } = require('../helpers/logger');
const { sendAlert } = require('../helpers/alertHelper');
const { recordAlertSent, recordJobStatus } = require('./metricsService');

const DEFAULT_MAX_ATTEMPTS = Math.max(Number(process.env.JOB_MAX_ATTEMPTS || 3), 1);
const DEFAULT_POLL_INTERVAL_MS = Math.max(Number(process.env.JOB_POLL_INTERVAL_MS || 5000), 1000);
const DEFAULT_CONCURRENCY = Math.max(Number(process.env.JOB_CONCURRENCY || 2), 1);
const DEFAULT_LOCK_TTL_MS = Math.max(Number(process.env.JOB_LOCK_TTL_MS || 5 * 60 * 1000), 30 * 1000);

let workerInterval = null;
let isProcessing = false;

const getHandlers = () => require('./jobRunners');

const enqueueJob = async ({
    type,
    payload,
    createdBy,
    createdByModel,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    priority = 10,
    runAt = new Date()
}) => {
    const job = await BackgroundJob.create({
        type,
        payload,
        createdBy: createdBy || undefined,
        createdByModel: createdByModel || undefined,
        maxAttempts,
        priority,
        runAt
    });

    recordJobStatus({ type, status: 'pending' });
    return job;
};

const claimNextJob = async () => {
    const now = new Date();
    const staleLockDate = new Date(now.getTime() - DEFAULT_LOCK_TTL_MS);

    return BackgroundJob.findOneAndUpdate(
        {
            status: { $in: ['pending', 'retry', 'running'] },
            runAt: { $lte: now },
            $or: [
                { lockedAt: null },
                { lockedAt: { $exists: false } },
                { lockedAt: { $lte: staleLockDate } }
            ]
        },
        {
            $set: {
                status: 'running',
                lockedAt: now,
                startedAt: now,
                errorMessage: ''
            }
        },
        {
            new: true,
            sort: { priority: 1, runAt: 1, createdAt: 1 }
        }
    );
};

const completeJob = async (job, result = {}) => {
    job.status = 'completed';
    job.result = result;
    job.completedAt = new Date();
    job.lockedAt = null;
    job.errorMessage = '';
    await job.save();
    recordJobStatus({ type: job.type, status: 'completed' });
};

const failJob = async (job, error) => {
    job.attempts += 1;
    job.errorMessage = error.message || 'Background job failed.';
    job.errorDetails = {
        stack: error.stack,
        updatedAt: new Date().toISOString()
    };
    job.lockedAt = null;

    if (job.attempts >= job.maxAttempts) {
        job.status = 'failed';
        job.failedAt = new Date();
        await job.save();
        recordJobStatus({ type: job.type, status: 'failed' });
        const delivered = await sendAlert({
            event: 'background_job_failed',
            severity: 'critical',
            message: `${job.type} job failed permanently.`,
            metadata: {
                jobId: String(job._id),
                error: job.errorMessage
            }
        });
        if (delivered) {
            recordAlertSent();
        }
        return;
    }

    const retryDelayMs = Math.min(60_000, 2 ** job.attempts * 1000);
    job.status = 'retry';
    job.runAt = new Date(Date.now() + retryDelayMs);
    await job.save();
    recordJobStatus({ type: job.type, status: 'retry' });
};

const processPendingJobs = async ({ limit = DEFAULT_CONCURRENCY } = {}) => {
    const processedJobs = [];

    for (let index = 0; index < limit; index += 1) {
        const job = await claimNextJob();
        if (!job) break;

        processedJobs.push(job);
        const handlers = getHandlers();

        try {
            const handler = handlers[job.type];
            if (!handler) {
                throw new Error(`No handler registered for job type ${job.type}.`);
            }

            logger.info('background_job.started', {
                jobId: String(job._id),
                type: job.type
            });
            const result = await handler(job);
            await completeJob(job, result);
            logger.info('background_job.completed', {
                jobId: String(job._id),
                type: job.type
            });
        } catch (error) {
            logger.error('background_job.failed', {
                jobId: String(job._id),
                type: job.type,
                error: error.message
            });
            await failJob(job, error);
        }
    }

    return processedJobs.length;
};

const startJobWorker = () => {
    if (workerInterval) return workerInterval;

    workerInterval = setInterval(async () => {
        if (isProcessing) return;
        isProcessing = true;
        try {
            await processPendingJobs();
        } finally {
            isProcessing = false;
        }
    }, DEFAULT_POLL_INTERVAL_MS);

    if (typeof workerInterval.unref === 'function') {
        workerInterval.unref();
    }

    return workerInterval;
};

const stopJobWorker = () => {
    if (workerInterval) {
        clearInterval(workerInterval);
        workerInterval = null;
    }
};

module.exports = {
    enqueueJob,
    processPendingJobs,
    startJobWorker,
    stopJobWorker
};
