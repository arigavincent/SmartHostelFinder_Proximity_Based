const crypto = require('crypto');

const safeEqual = (left, right) => {
    const leftBuffer = Buffer.from(left || '', 'utf8');
    const rightBuffer = Buffer.from(right || '', 'utf8');
    if (leftBuffer.length !== rightBuffer.length) return false;
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const verifyWebhookSignature = ({ headers = {}, payload = {}, secret }) => {
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
