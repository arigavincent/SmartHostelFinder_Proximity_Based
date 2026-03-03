const crypto = require('crypto');

const SUPPORTED_PROVIDERS = new Set(['mpesa', 'card']);
const SUCCESS_VALUES = new Set(['success', 'succeeded', 'paid', 'completed', 'ok', '0', 0]);
const FAILED_VALUES = new Set(['failed', 'failure', 'declined', 'error']);
const CANCELLED_VALUES = new Set(['cancelled', 'canceled', '1032']);
const TIMEOUT_VALUES = new Set(['timeout', 'timed_out', '1037']);

const normalizeProvider = (provider) => {
    if (!provider) return null;
    const value = String(provider).trim().toLowerCase();
    if (value === 'm-pesa') return 'mpesa';
    return SUPPORTED_PROVIDERS.has(value) ? value : null;
};

const mapProviderStatus = (rawStatus) => {
    const value = String(rawStatus ?? '').trim().toLowerCase();
    if (value === '') return 'pending';
    if (SUCCESS_VALUES.has(value)) return 'succeeded';
    if (FAILED_VALUES.has(value)) return 'failed';
    if (CANCELLED_VALUES.has(value)) return 'cancelled';
    if (TIMEOUT_VALUES.has(value)) return 'timeout';
    return 'pending';
};

const initializePaymentWithProvider = async ({
    provider,
    amount,
    currency,
    bookingId,
    idempotencyKey,
    payer
}) => {
    const normalizedProvider = normalizeProvider(provider);
    if (!normalizedProvider) {
        throw new Error('Unsupported payment provider.');
    }

    // Note: M-Pesa initialization is handled in the controller via the specialized utility.
    // This remains as a skeleton for Card/Stripe/etc.
    return {
        status: 'pending',
        providerRequestId: `REQ-${Date.now()}-${crypto.randomInt(100, 1000)}`,
        providerCheckoutId: `CHK-${Date.now()}-${crypto.randomInt(100, 1000)}`,
        providerReference: null,
        rawResponse: {
            mode: 'mock',
            provider: normalizedProvider,
            amount,
            currency,
            bookingId,
            idempotencyKey,
            payer
        }
    };
};

const parseProviderWebhook = (provider, payload = {}) => {
    const normalizedProvider = normalizeProvider(provider);
    if (!normalizedProvider) {
        throw new Error('Unsupported payment provider.');
    }

    // Specialized parsing for M-Pesa STK Push Callbacks
    if (normalizedProvider === 'mpesa' && payload.Body?.stkCallback) {
        const callback = payload.Body.stkCallback;
        const metadata = {};
        
        if (callback.CallbackMetadata?.Item) {
            callback.CallbackMetadata.Item.forEach(item => {
                metadata[item.Name] = item.Value;
            });
        }

        return {
            provider: 'mpesa',
            status: mapProviderStatus(callback.ResultCode),
            eventId: callback.CheckoutRequestID, // Use CheckoutRequestID as event uniqueness
            providerTransactionId: metadata.MpesaReceiptNumber || null,
            providerRequestId: callback.MerchantRequestID || null,
            providerCheckoutId: callback.CheckoutRequestID || null,
            providerReference: metadata.MpesaReceiptNumber || null,
            idempotencyKey: null, // Safaricom doesn't return our custom key
            failureCode: String(callback.ResultCode),
            failureReason: callback.ResultDesc || null,
            rawPayload: payload
        };
    }

    // Standard parsing for Card/Other providers
    const status = mapProviderStatus(
        payload.status
        || payload.result
        || payload.resultCode
        || payload.result_code
        || payload.data?.status
    );

    return {
        provider: normalizedProvider,
        status,
        eventId: payload.eventId || payload.event_id || payload.id || null,
        providerTransactionId: payload.transactionId || payload.transaction_id || payload.data?.transactionId || null,
        providerRequestId: payload.requestId || payload.request_id || payload.checkoutRequestId || payload.checkout_request_id || payload.data?.requestId || null,
        providerCheckoutId: payload.checkoutId || payload.checkout_id || payload.data?.checkoutId || null,
        providerReference: payload.reference || payload.providerReference || payload.data?.reference || null,
        idempotencyKey: payload.idempotencyKey || payload.idempotency_key || payload.metadata?.idempotencyKey || null,
        failureCode: payload.failureCode || payload.failure_code || payload.data?.failureCode || null,
        failureReason: payload.failureReason || payload.failure_reason || payload.message || payload.data?.failureReason || null,
        rawPayload: payload
    };
};

module.exports = {
    normalizeProvider,
    mapProviderStatus,
    initializePaymentWithProvider,
    parseProviderWebhook
};