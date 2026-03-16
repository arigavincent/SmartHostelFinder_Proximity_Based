const parseOrigins = (value) => String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const toNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const validateEnv = () => {
    const environment = process.env.NODE_ENV || 'development';
    const missing = [];

    if (!process.env.MONGO_URI) missing.push('MONGO_URI');
    if (!process.env.JWT_SECRET) missing.push('JWT_SECRET');

    if (environment === 'production' && !process.env.SERVER_URL) {
        missing.push('SERVER_URL');
    }

    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    return {
        nodeEnv: environment,
        port: toNumber(process.env.PORT, 5100),
        mongoUri: process.env.MONGO_URI,
        jwtSecret: process.env.JWT_SECRET,
        jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
        clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',
        serverUrl: process.env.SERVER_URL || `http://localhost:${toNumber(process.env.PORT, 5100)}`,
        corsOrigins: parseOrigins(process.env.CORS_ORIGINS || process.env.CLIENT_URL || 'http://localhost:3000,http://localhost:5173'),
        bodyLimit: process.env.BODY_LIMIT || '2mb',
        rateLimitWindowMs: toNumber(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
        rateLimitMax: toNumber(process.env.RATE_LIMIT_MAX, 300),
        authRateLimitMax: toNumber(process.env.AUTH_RATE_LIMIT_MAX, 20),
        trustProxy: ['1', 'true', 'yes'].includes(String(process.env.TRUST_PROXY || '').toLowerCase()),
        jobWorkerInline: environment !== 'test' && !['0', 'false', 'no'].includes(String(process.env.JOB_WORKER_INLINE || 'true').toLowerCase()),
        jobPollIntervalMs: toNumber(process.env.JOB_POLL_INTERVAL_MS, 5000),
        jobConcurrency: toNumber(process.env.JOB_CONCURRENCY, 2),
        storageProvider: String(process.env.STORAGE_PROVIDER || 'local').trim().toLowerCase(),
        metricsToken: String(process.env.METRICS_TOKEN || '').trim()
    };
};

module.exports = { validateEnv };
