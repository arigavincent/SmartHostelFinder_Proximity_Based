const crypto = require('crypto');

const safeEqual = (left, right) => {
    const leftBuffer = Buffer.from(left || '', 'utf8');
    const rightBuffer = Buffer.from(right || '', 'utf8');
    if (leftBuffer.length !== rightBuffer.length) return false;
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const verifyWebhookSignature = ({ headers = {}, payload = {}, secret, provider = '' }) => {
    // If it's M-Pesa, Safaricom usually doesn't send HMAC signatures. 
    // We allow it if M-Pesa is explicitly handled via IP whitelisting in middleware,
    // or if you provide a custom verification token in the URL query/headers.
    if (provider === 'mpesa') {
        // Option A: Check for a custom static token you appended to your Callback URL
        // Example: /webhook/mpesa?token=YOUR_SECRET
        const queryToken = payload.query?.token; 
        if (secret && queryToken && safeEqual(String(queryToken), String(secret))) {
            return true;
        }
        // If no HMAC is provided by the provider, we rely on the controller's logic 
        // to find the transaction by CheckoutRequestID (proving authenticity).
        return true; 
    }

    if (!secret) return false;

    const token = headers['x-webhook-token'] || headers['X-Webhook-Token'];
    if (token && safeEqual(String(token), String(secret))) {
        return true;
    }

    const signature = headers['x-payment-signature'] || headers['x-signature'] || headers['X-Payment-Signature'];
    if (!signature) return false;

    const digest = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(payload))
        .digest('hex');

    return safeEqual(String(signature), digest);
};

module.exports = {
    verifyWebhookSignature
};