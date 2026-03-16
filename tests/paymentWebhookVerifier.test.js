const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { verifyWebhookSignature } = require('../helpers/paymentWebhookVerifier');

test('verifyWebhookSignature accepts valid token auth', () => {
    const payload = { id: 'evt-1', status: 'success' };
    const ok = verifyWebhookSignature({
        headers: { 'x-webhook-token': 'secret-token' },
        payload,
        secret: 'secret-token'
    });

    assert.equal(ok, true);
});

test('verifyWebhookSignature accepts valid hmac signature', () => {
    const payload = { id: 'evt-1', status: 'success' };
    const secret = 'secret-hmac';
    const signature = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(payload))
        .digest('hex');

    const ok = verifyWebhookSignature({
        headers: { 'x-payment-signature': signature },
        payload,
        secret
    });

    assert.equal(ok, true);
});

test('verifyWebhookSignature rejects invalid signature', () => {
    const payload = { id: 'evt-1', status: 'failed' };
    const ok = verifyWebhookSignature({
        headers: { 'x-payment-signature': 'bad-signature' },
        payload,
        secret: 'secret-hmac'
    });

    assert.equal(ok, false);
});

test('verifyWebhookSignature accepts mpesa token from query string', () => {
    const ok = verifyWebhookSignature({
        provider: 'mpesa',
        query: { token: 'mpesa-secret' },
        payload: { Body: { stkCallback: {} } },
        secret: 'mpesa-secret'
    });

    assert.equal(ok, true);
});

test('verifyWebhookSignature rejects mpesa webhook without token', () => {
    const ok = verifyWebhookSignature({
        provider: 'mpesa',
        payload: { Body: { stkCallback: {} } },
        secret: 'mpesa-secret'
    });

    assert.equal(ok, false);
});
