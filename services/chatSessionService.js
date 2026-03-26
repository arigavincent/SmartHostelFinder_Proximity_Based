const mongoose = require('mongoose');

const ChatSession = require('../models/ChatSession');

const isPersistenceReady = () => mongoose.connection.readyState === 1;

const deriveSessionTitle = (message) => {
    const value = String(message || '').trim().replace(/\s+/g, ' ');
    return value.length <= 80 ? value : `${value.slice(0, 77)}...`;
};

const toHistory = (messages = []) => messages.map((message) => ({
    role: message.role,
    content: message.content
}));

const serializeSession = (session) => ({
    sessionId: String(session._id),
    userRole: session.userRole,
    userId: session.userId || null,
    sessionTitle: session.sessionTitle || null,
    lastMessageAt: session.lastMessageAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages: session.messages.map((message) => ({
        id: String(message._id),
        role: message.role,
        content: message.content,
        createdAt: message.createdAt
    }))
});

const canAccessSession = (session, user) => {
    if (!session) return false;
    if (!session.userId) return true;
    if (!user) return false;
    if (user.role === 'admin') return true;
    return String(session.userId) === String(user.id || '');
};

const prepareRequest = async ({ sessionId, history, user }) => {
    if (!isPersistenceReady() || !sessionId || !mongoose.isValidObjectId(sessionId)) {
        return {
            sessionId: sessionId || null,
            history: Array.isArray(history) ? history : [],
            existingSession: null
        };
    }

    const existingSession = await ChatSession.findById(sessionId).select('messages userId userRole');
    if (!existingSession) {
        return {
            sessionId: null,
            history: Array.isArray(history) ? history : [],
            existingSession: null
        };
    }

    if (!canAccessSession(existingSession, user)) {
        const error = new Error('You are not allowed to use this chat session.');
        error.statusCode = 403;
        error.publicMessage = 'You are not allowed to use this chat session.';
        throw error;
    }

    return {
        sessionId: String(existingSession._id),
        history: toHistory(existingSession.messages),
        existingSession
    };
};

const persistExchange = async ({
    sessionId,
    user,
    context,
    userMessage,
    assistantReply,
    provider,
    model
}) => {
    if (!isPersistenceReady()) {
        return sessionId || null;
    }

    let session = null;
    if (sessionId && mongoose.isValidObjectId(sessionId)) {
        session = await ChatSession.findById(sessionId);
    }

    if (!session) {
        session = new ChatSession({
            userRole: user?.role || 'guest',
            userId: user?.id ? String(user.id).trim() : undefined,
            sessionTitle: deriveSessionTitle(userMessage),
            metadata: {}
        });
    }

    session.userRole = user?.role || session.userRole || 'guest';
    if (user?.id) {
        session.userId = String(user.id).trim();
    }

    session.messages.push(
        { role: 'user', content: String(userMessage || '').trim() },
        { role: 'assistant', content: String(assistantReply || '').trim() }
    );
    session.lastMessageAt = new Date();
    session.metadata = {
        ...(session.metadata || {}),
        latestContext: context || {},
        lastProvider: provider || null,
        lastModel: model || null
    };

    await session.save();
    return String(session._id);
};

const getSessionById = async (sessionId) => {
    if (!isPersistenceReady()) {
        return null;
    }

    if (!sessionId || !mongoose.isValidObjectId(sessionId)) {
        return null;
    }

    const session = await ChatSession.findById(sessionId);
    return session ? serializeSession(session) : null;
};

module.exports = {
    canAccessSession,
    prepareRequest,
    persistExchange,
    getSessionById
};
