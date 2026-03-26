const axios = require('axios');

const buildServiceError = (statusCode, publicMessage, cause) => {
    const error = new Error(publicMessage);
    error.statusCode = statusCode;
    error.publicMessage = publicMessage;
    error.cause = cause;
    return error;
};

const buildHeaders = (requestId, token) => {
    const headers = {
        'Content-Type': 'application/json'
    };

    if (requestId) {
        headers['X-Request-Id'] = requestId;
    }

    if (token) {
        headers['X-Internal-Service-Token'] = token;
    }

    return headers;
};

const sendMessage = async ({ env, requestId, payload }) => {
    const chatbotServiceUrl = String(env?.chatbotServiceUrl || '').trim().replace(/\/+$/, '');
    if (!chatbotServiceUrl) {
        throw buildServiceError(503, 'Chatbot service is not configured.');
    }

    try {
        const response = await axios.post(
            `${chatbotServiceUrl}/api/chat/respond`,
            payload,
            {
                timeout: env.chatbotServiceTimeoutMs,
                headers: buildHeaders(requestId, env.chatbotServiceToken)
            }
        );

        return response.data;
    } catch (error) {
        if (error.code === 'ECONNABORTED') {
            throw buildServiceError(504, 'Chatbot service timed out.', error);
        }

        if (error.response) {
            throw buildServiceError(
                502,
                'Chatbot service is unavailable right now.',
                error
            );
        }

        throw buildServiceError(503, 'Could not reach the chatbot service.', error);
    }
};

module.exports = { sendMessage };
