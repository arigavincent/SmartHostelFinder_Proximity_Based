const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizeProvider,
    mapProviderStatus,
    parseProviderWebhook
} = require('../helpers/paymentProvider');

test('normalizeProvider supports mpesa variants and card', () => {
    assert.equal(normalizeProvider('m-pesa'), 'mpesa');
    assert.equal(normalizeProvider('mpesa'), 'mpesa');
    assert.equal(normalizeProvider('card'), 'card');
    assert.equal(normalizeProvider('paypal'), null);
});

test('mapProviderStatus maps terminal and pending states', () => {
    assert.equal(mapProviderStatus('success'), 'succeeded');
    assert.equal(mapProviderStatus('FAILED'), 'failed');
    assert.equal(mapProviderStatus('cancelled'), 'cancelled');
    assert.equal(mapProviderStatus('timeout'), 'timeout');
    assert.equal(mapProviderStatus('queued'), 'pending');
});

test('parseProviderWebhook extracts canonical fields', () => {
    const parsed = parseProviderWebhook('mpesa', {
        event_id: 'evt-1',
        status: 'success',
        transaction_id: 'tx-123',
        checkout_request_id: 'req-999',
        reference: 'R-1',
        idempotency_key: 'idem-1'
    });

    assert.equal(parsed.provider, 'mpesa');
    assert.equal(parsed.status, 'succeeded');
    assert.equal(parsed.eventId, 'evt-1');
    assert.equal(parsed.providerTransactionId, 'tx-123');
    assert.equal(parsed.providerRequestId, 'req-999');
    assert.equal(parsed.providerReference, 'R-1');
    assert.equal(parsed.idempotencyKey, 'idem-1');
});
