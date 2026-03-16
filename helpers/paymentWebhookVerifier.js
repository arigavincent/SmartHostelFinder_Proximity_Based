const crypto = require('crypto');

const safeEqual = (left, right) => {
    const leftBuffer = Buffer.from(left || '', 'utf8');
    const rightBuffer = Buffer.from(right || '', 'utf8');
    if (leftBuffer.length !== rightBuffer.length) return false;
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const getHeaderValue = (headers, key) => {
    const requestedKey = String(key || '').toLowerCase();
    for (const [headerName, headerValue] of Object.entries(headers || {})) {
        if (String(headerName).toLowerCase() === requestedKey) {
            return Array.isArray(headerValue) ? headerValue[0] : headerValue;
        }
    }
    return undefined;
};

const verifyWebhookSignature = ({ headers = {}, payload = {}, query = {}, secret, provider = '' }) => {
    const headerToken = getHeaderValue(headers, 'x-webhook-token');

    // Safaricom callbacks do not include signed headers by default.
    // Require a shared token in callback query params or a trusted header.
    if (provider === 'mpesa') {
        if (!secret) return false;
        const queryToken = query?.token;
        const providedToken = queryToken || headerToken;
        if (!providedToken) return false;
        return safeEqual(String(providedToken), String(secret));
    }

    if (!secret) return false;

    if (headerToken && safeEqual(String(headerToken), String(secret))) {
        return true;
    }

    const signature = getHeaderValue(headers, 'x-payment-signature') || getHeaderValue(headers, 'x-signature');
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
