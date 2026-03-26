const chatbotService = require('../services/chatbotService');
const chatbotContextService = require('../services/chatbotContextService');
const chatSessionService = require('../services/chatSessionService');
const { logger } = require('../helpers/logger');

const allowedRoles = new Set(['guest', 'student', 'owner', 'admin']);
const allowedMessageRoles = new Set(['user', 'assistant']);
const MAX_HISTORY_MESSAGES = 20;
const MAX_CONTEXT_KEYS = 30;
const MAX_CONTEXT_VALUE_LENGTH = 500;
const MAX_SESSION_ID_LENGTH = 128;

const sanitizeMessage = (value) => String(value || '').trim();

const normalizeHistory = (history) => {
    if (history === undefined) {
        return [];
    }

    if (!Array.isArray(history)) {
        return null;
    }

    const normalized = [];
    for (const item of history.slice(-MAX_HISTORY_MESSAGES)) {
        if (!item || typeof item !== 'object') {
            return null;
        }

        const role = String(item.role || '').trim();
        const content = sanitizeMessage(item.content);

        if (!allowedMessageRoles.has(role) || !content) {
            return null;
        }

        normalized.push({ role, content });
    }

    return normalized;
};

const sanitizeContextValue = (value, depth = 0) => {
    if (depth > 3) {
        return '[truncated]';
    }

    if (value === null || value === undefined) {
        return value;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > MAX_CONTEXT_VALUE_LENGTH
            ? `${trimmed.slice(0, MAX_CONTEXT_VALUE_LENGTH)}...`
            : trimmed;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }

    if (Array.isArray(value)) {
        return value.slice(0, 10).map((item) => sanitizeContextValue(item, depth + 1));
    }

    if (typeof value === 'object') {
        const result = {};
        for (const [key, item] of Object.entries(value).slice(0, MAX_CONTEXT_KEYS)) {
            result[key] = sanitizeContextValue(item, depth + 1);
        }
        return result;
    }

    return String(value);
};

const normalizeUser = (user) => {
    if (user === undefined || user === null) {
        return null;
    }

    if (!user || typeof user !== 'object' || Array.isArray(user)) {
        return null;
    }

    const role = String(user.role || 'guest').trim();
    if (!allowedRoles.has(role)) {
        return null;
    }

    return {
        id: user.id ? String(user.id).trim() : undefined,
        role
    };
};

exports.sendMessage = async (req, res) => {
    try {
        const message = sanitizeMessage(req.body.message);
        if (!message) {
            return res.status(400).json({
                message: 'A non-empty chat message is required.',
                requestId: req.requestId
            });
        }

        const history = normalizeHistory(req.body.history);
        if (history === null) {
            return res.status(400).json({
                message: 'History must be an array of chat messages.',
                requestId: req.requestId
            });
        }

        const user = normalizeUser(req.body.user);
        if (req.body.user !== undefined && user === null) {
            return res.status(400).json({
                message: 'User must include a supported role.',
                requestId: req.requestId
            });
        }

        const rawContext = req.body.context === undefined
            ? {}
            : (req.body.context && typeof req.body.context === 'object' && !Array.isArray(req.body.context)
                ? req.body.context
                : null);

        if (rawContext === null) {
            return res.status(400).json({
                message: 'Context must be an object when provided.',
                requestId: req.requestId
            });
        }

        const context = sanitizeContextValue(rawContext);

        const sessionId = req.body.sessionId === undefined || req.body.sessionId === null
            ? null
            : String(req.body.sessionId).trim() || null;

        if (sessionId && sessionId.length > MAX_SESSION_ID_LENGTH) {
            return res.status(400).json({
                message: 'Session id is too long.',
                requestId: req.requestId
            });
        }

        const effectiveUser = req.user
            ? {
                id: req.user.id,
                role: req.user.role
            }
            : user;

        const groundedContext = await chatbotContextService.buildContext({
            user: effectiveUser,
            clientContext: context
        });

        const preparedRequest = await chatSessionService.prepareRequest({
            sessionId,
            history,
            user: effectiveUser
        });

        const response = await chatbotService.sendMessage({
            env: req.app.locals.env,
            requestId: req.requestId,
            payload: {
                sessionId: preparedRequest.sessionId,
                message,
                user: effectiveUser,
                history: preparedRequest.history,
                context: groundedContext
            }
        });

        let persistedSessionId = response.sessionId ?? preparedRequest.sessionId ?? sessionId;
        try {
            persistedSessionId = await chatSessionService.persistExchange({
                sessionId: persistedSessionId,
                user: effectiveUser,
                context: groundedContext,
                userMessage: message,
                assistantReply: response.reply,
                provider: response.provider,
                model: response.model
            });
        } catch (persistError) {
            logger.error('chatbot.session_persist_failed', {
                requestId: req.requestId,
                error: persistError.message
            });
        }

        return res.status(200).json({
            ...response,
            sessionId: persistedSessionId
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            message: error.publicMessage || 'Internal server error',
            requestId: req.requestId
        });
    }
};

exports.getSession = async (req, res) => {
    try {
        const session = await chatSessionService.getSessionById(req.params.sessionId);
        if (!session) {
            return res.status(404).json({
                message: 'Chat session not found.',
                requestId: req.requestId
            });
        }

        if (!chatSessionService.canAccessSession(session, req.user)) {
            return res.status(403).json({
                message: 'You are not allowed to access this chat session.',
                requestId: req.requestId
            });
        }

        return res.status(200).json(session);
    } catch (error) {
        return res.status(500).json({
            message: 'Internal server error',
            requestId: req.requestId
        });
    }
};
