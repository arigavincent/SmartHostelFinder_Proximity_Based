const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createApp } = require('../app');

const testEnv = {
    nodeEnv: 'test',
    port: 0,
    mongoUri: 'mongodb://localhost:27017/test',
    jwtSecret: 'test-secret',
    jwtExpiresIn: '30d',
    clientUrl: 'http://localhost:3000',
    serverUrl: 'http://localhost:5100',
    corsOrigins: ['http://localhost:3000'],
    bodyLimit: '2mb',
    rateLimitWindowMs: 60 * 1000,
    rateLimitMax: 5,
    authRateLimitMax: 1,
    trustProxy: false
};

test('GET /api/health returns health payload and request id header', async () => {
    const app = createApp(testEnv);
    const response = await request(app).get('/api/health');

    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'OK');
    assert.equal(response.body.environment, 'test');
    assert.ok(response.body.requestId);
    assert.equal(response.headers['x-request-id'], response.body.requestId);
});

test('unknown route returns 404 with request id', async () => {
    const app = createApp(testEnv);
    const response = await request(app).get('/api/does-not-exist');

    assert.equal(response.status, 404);
    assert.equal(response.body.message, 'Route not found');
    assert.ok(response.body.requestId);
});

test('cors rejects unknown origin with structured error response', async () => {
    const app = createApp(testEnv);
    const response = await request(app)
        .get('/api/health')
        .set('Origin', 'http://evil.example');

    assert.equal(response.status, 403);
    assert.equal(response.body.message, 'Origin not allowed by CORS');
    assert.ok(response.body.requestId);
});

test('auth routes are rate limited before controller logic', async () => {
    const app = createApp(testEnv);

    const first = await request(app)
        .post('/api/auth/login')
        .send({});

    const second = await request(app)
        .post('/api/auth/login')
        .send({});

    assert.equal(first.status, 400);
    assert.equal(second.status, 429);
    assert.equal(second.body.message, 'Too many authentication attempts. Please try again later.');
    assert.ok(second.body.requestId);
});
