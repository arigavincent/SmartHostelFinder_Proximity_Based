const test = require('node:test');
const assert = require('node:assert/strict');

const { validateEnv } = require('../config/env');

const withEnv = (overrides, callback) => {
    const original = { ...process.env };
    Object.keys(process.env).forEach((key) => {
        delete process.env[key];
    });
    Object.assign(process.env, original, overrides);

    try {
        callback();
    } finally {
        Object.keys(process.env).forEach((key) => {
            delete process.env[key];
        });
        Object.assign(process.env, original);
    }
};

test('validateEnv returns normalized runtime config for development', () => {
    withEnv({
        NODE_ENV: 'development',
        PORT: '5200',
        MONGO_URI: 'mongodb://localhost:27017/test',
        JWT_SECRET: 'super-secret',
        CLIENT_URL: 'http://localhost:3000',
        CORS_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        RATE_LIMIT_WINDOW_MS: '120000',
        RATE_LIMIT_MAX: '100',
        AUTH_RATE_LIMIT_MAX: '10',
        TRUST_PROXY: 'true'
    }, () => {
        const env = validateEnv();

        assert.equal(env.nodeEnv, 'development');
        assert.equal(env.port, 5200);
        assert.equal(env.mongoUri, 'mongodb://localhost:27017/test');
        assert.equal(env.jwtSecret, 'super-secret');
        assert.deepEqual(env.corsOrigins, ['http://localhost:3000', 'http://localhost:5173']);
        assert.equal(env.rateLimitWindowMs, 120000);
        assert.equal(env.rateLimitMax, 100);
        assert.equal(env.authRateLimitMax, 10);
        assert.equal(env.chatbotRateLimitMax, 60);
        assert.equal(env.trustProxy, true);
        assert.equal(env.chatbotServiceUrl, 'http://localhost:8000');
        assert.equal(env.chatbotServiceTimeoutMs, 30000);
        assert.equal(env.chatbotServiceToken, '');
    });
});

test('validateEnv includes clientUrl in cors origins when not explicitly listed', () => {
    withEnv({
        NODE_ENV: 'development',
        MONGO_URI: 'mongodb://localhost:27017/test',
        JWT_SECRET: 'super-secret',
        CLIENT_URL: 'http://localhost:5174',
        CORS_ORIGINS: 'http://localhost:3000,http://localhost:5173'
    }, () => {
        const env = validateEnv();

        assert.deepEqual(env.corsOrigins, [
            'http://localhost:3000',
            'http://localhost:5173',
            'http://localhost:5174'
        ]);
    });
});

test('validateEnv requires critical variables in production', () => {
    withEnv({
        NODE_ENV: 'production',
        MONGO_URI: '',
        JWT_SECRET: '',
        SERVER_URL: ''
    }, () => {
        assert.throws(() => validateEnv(), /Missing required environment variables/);
    });
});
