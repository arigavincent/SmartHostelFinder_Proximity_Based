const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const axios = require('axios');
const jwt = require('jsonwebtoken');

const {
    connectTestDatabase,
    clearDatabase,
    disconnectTestDatabase
} = require('./helpers/integrationTestHelper');
const { createApp } = require('../app');
const ChatSession = require('../models/ChatSession');
const Hostel = require('../models/Hostel');
const Owner = require('../models/Owners');
const PaymentTransaction = require('../models/PaymentTransaction');
const Student = require('../models/Students');
const Booking = require('../models/Booking');
const { hashPassword } = require('../helpers/passwordHelper');

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
    rateLimitMax: 200,
    authRateLimitMax: 50,
    chatbotRateLimitMax: 100,
    trustProxy: false,
    jobWorkerInline: false,
    jobPollIntervalMs: 5000,
    jobConcurrency: 1,
    chatbotServiceUrl: 'http://chatbot.local',
    chatbotServiceTimeoutMs: 3000,
    chatbotServiceToken: 'internal-token',
    storageProvider: 'local',
    metricsToken: ''
};

const app = createApp(testEnv);

const signToken = (user) => jwt.sign(
    { id: String(user._id), email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
);

test.before(async () => {
    await connectTestDatabase();
});

test.after(async () => {
    await disconnectTestDatabase();
});

test.afterEach(async () => {
    await clearDatabase();
});

test('POST /api/chatbot/message proxies a valid request to the chatbot service', { concurrency: false }, async (t) => {
    t.mock.method(axios, 'post', async (url, payload, options) => {
        assert.equal(url, 'http://chatbot.local/api/chat/respond');
        assert.equal(options.timeout, 3000);
        assert.equal(options.headers['X-Internal-Service-Token'], 'internal-token');
        assert.equal(payload.message, 'How do I book a hostel near Kirinyaga University?');
        assert.equal(payload.user.role, 'student');

        return {
            data: {
                sessionId: 'session-1',
                reply: 'Use the search page and filter by Kirinyaga University.',
                model: 'gemini-2.5-flash',
                provider: 'gemini',
                usedStub: false,
                suggestions: []
            }
        };
    });

    const response = await request(app)
        .post('/api/chatbot/message')
        .send({
            sessionId: 'session-1',
            message: 'How do I book a hostel near Kirinyaga University?',
            user: { id: 'student-1', role: 'student' },
            history: [],
            context: { primaryUniversity: 'Kirinyaga University' }
        });

    assert.equal(response.status, 200);
    assert.equal(response.body.provider, 'gemini');
    assert.equal(response.body.usedStub, false);
    assert.equal(response.body.reply, 'Use the search page and filter by Kirinyaga University.');
});

test('POST /api/chatbot/message validates request payloads', { concurrency: false }, async () => {
    const response = await request(app)
        .post('/api/chatbot/message')
        .send({
            message: '   ',
            history: 'not-an-array'
        });

    assert.equal(response.status, 400);
    assert.equal(response.body.message, 'A non-empty chat message is required.');
    assert.ok(response.body.requestId);
});

test('POST /api/chatbot/message maps chatbot timeouts to a gateway timeout response', { concurrency: false }, async (t) => {
    t.mock.method(axios, 'post', async () => {
        const error = new Error('timeout');
        error.code = 'ECONNABORTED';
        throw error;
    });

    const response = await request(app)
        .post('/api/chatbot/message')
        .send({
            message: 'Hello there'
        });

    assert.equal(response.status, 504);
    assert.equal(response.body.message, 'Chatbot service timed out.');
    assert.ok(response.body.requestId);
});

test('chatbot sessions are persisted and reused on subsequent turns', { concurrency: false }, async (t) => {
    const outboundPayloads = [];

    t.mock.method(axios, 'post', async (url, payload) => {
        outboundPayloads.push({ url, payload });
        return {
            data: {
                reply: `Reply ${outboundPayloads.length}`,
                model: 'gemini-2.5-flash',
                provider: 'gemini',
                usedStub: false,
                suggestions: []
            }
        };
    });

    const firstResponse = await request(app)
        .post('/api/chatbot/message')
        .send({
            message: 'How do I book a hostel near Kirinyaga University?',
            history: [],
            context: { primaryUniversity: 'Kirinyaga University' }
        });

    assert.equal(firstResponse.status, 200);
    assert.equal(firstResponse.body.reply, 'Reply 1');
    assert.ok(firstResponse.body.sessionId);

    const storedSession = await ChatSession.findById(firstResponse.body.sessionId);
    assert.ok(storedSession);
    assert.equal(storedSession.messages.length, 2);
    assert.equal(storedSession.messages[0].role, 'user');
    assert.equal(storedSession.messages[1].role, 'assistant');

    const secondResponse = await request(app)
        .post('/api/chatbot/message')
        .send({
            sessionId: firstResponse.body.sessionId,
            message: 'What payment methods are available?',
            history: [],
            context: { primaryUniversity: 'Kirinyaga University' }
        });

    assert.equal(secondResponse.status, 200);
    assert.equal(secondResponse.body.sessionId, firstResponse.body.sessionId);
    assert.equal(outboundPayloads[1].payload.history.length, 2);
    assert.equal(outboundPayloads[1].payload.history[0].content, 'How do I book a hostel near Kirinyaga University?');

    const reloadedSession = await request(app)
        .get(`/api/chatbot/sessions/${firstResponse.body.sessionId}`);

    assert.equal(reloadedSession.status, 200);
    assert.equal(reloadedSession.body.sessionId, firstResponse.body.sessionId);
    assert.equal(reloadedSession.body.messages.length, 4);
    assert.equal(reloadedSession.body.messages[3].content, 'Reply 2');
});

test('chatbot request includes grounded student context from backend data', { concurrency: false }, async (t) => {
    const student = await Student.create({
        username: 'Context Student',
        email: 'context@student.test',
        password: await hashPassword('Passw0rd'),
        isEmailVerified: true
    });
    const owner = await Owner.create({
        username: 'Context Owner',
        email: 'context-owner@test.local',
        password: await hashPassword('Passw0rd'),
        role: 'owner',
        isEmailVerified: true,
        isApproved: true,
        businessLicense: 'private/documents/context-license.pdf'
    });
    const hostel = await Hostel.create({
        name: 'Kirinyaga Heights',
        description: 'Near campus',
        owner: owner._id,
        location: {
            type: 'Point',
            coordinates: [37.2783, -0.4989],
            address: 'Kutus',
            city: 'Kerugoya',
            nearbyUniversity: 'Kirinyaga University'
        },
        pricePerMonth: 8500,
        hostelType: 'mixed',
        totalRooms: 24,
        availableRooms: 6,
        amenities: { wifi: true, water: true, security: true },
        images: [],
        isApproved: true,
        isActive: true,
        contactPhone: '0712345678',
        contactEmail: owner.email
    });

    student.favorites.push(hostel._id);
    await student.save();

    await Booking.create({
        hostel: hostel._id,
        student: student._id,
        owner: owner._id,
        roomsBooked: 1,
        startDate: new Date('2026-05-01'),
        endDate: new Date('2026-06-01'),
        amount: 8500,
        currency: 'KES',
        status: 'pending_payment',
        payment: {
            method: 'mpesa',
            status: 'pending'
        }
    });

    await PaymentTransaction.create({
        booking: (await Booking.findOne({ student: student._id }).select('_id'))._id,
        student: student._id,
        owner: owner._id,
        provider: 'mpesa',
        amount: 8500,
        currency: 'KES',
        status: 'pending',
        idempotencyKey: 'payment-context-1',
        failureReason: ''
    });

    let seenPayload = null;
    t.mock.method(axios, 'post', async (url, payload) => {
        seenPayload = payload;
        return {
            data: {
                reply: 'Grounded reply',
                model: 'gemini-2.5-flash',
                provider: 'gemini',
                usedStub: false,
                suggestions: []
            }
        };
    });

    const token = signToken(student);
    const response = await request(app)
        .post('/api/chatbot/message')
        .set('Authorization', `Bearer ${token}`)
        .send({
            message: 'What are my options near KyU?',
            context: { channel: 'web-chat-widget' }
        });

    assert.equal(response.status, 200);
    assert.ok(seenPayload);
    assert.equal(seenPayload.user.role, 'student');
    assert.equal(seenPayload.context.userRole, 'student');
    assert.equal(seenPayload.context.roleContext.profile.username, 'Context Student');
    assert.equal(seenPayload.context.roleContext.favorites[0].name, 'Kirinyaga Heights');
    assert.equal(seenPayload.context.roleContext.recentBookings[0].roomsBooked, 1);
    assert.equal(seenPayload.context.roleContext.recentBookings[0].startDate, '2026-05-01');
    assert.equal(seenPayload.context.roleContext.recentBookings[0].paymentMethod, 'mpesa');
    assert.equal(seenPayload.context.roleContext.bookingActionSummary.pendingPaymentBookings, 1);
    assert.equal(seenPayload.context.roleContext.recommendationSignals.preferredCities[0].value, 'Kerugoya');
    assert.equal(seenPayload.context.roleContext.recommendationSignals.priceBand.max, 8500);
    assert.equal(seenPayload.context.roleContext.recentPayments[0].status, 'pending');
    assert.equal(seenPayload.context.livePlatformSnapshot.approvedActiveHostelCount, 1);
    assert.equal(seenPayload.context.livePlatformSnapshot.hostelsByUniversity[0].count, 1);
    assert.equal(seenPayload.context.livePlatformSnapshot.universityCoverageSample.includes('Kirinyaga University'), true);
});

test('chatbot request resolves a public hostel match for named hostel questions', { concurrency: false }, async (t) => {
    const owner = await Owner.create({
        username: 'Riverside Owner',
        email: 'riverside-owner@test.local',
        password: await hashPassword('Passw0rd'),
        role: 'owner',
        isEmailVerified: true,
        isApproved: true,
        businessLicense: 'private/documents/riverside-license.pdf'
    });

    await Hostel.create({
        name: 'Riverside Executive Suites',
        description: 'Modern rooms near campus with strong Wi-Fi and water.',
        owner: owner._id,
        location: {
            type: 'Point',
            coordinates: [37.2783, -0.4989],
            address: 'Kutus',
            city: 'Kerugoya',
            nearbyUniversity: 'Kirinyaga University'
        },
        pricePerMonth: 9200,
        hostelType: 'mixed',
        totalRooms: 30,
        availableRooms: 5,
        amenities: { wifi: true, water: true, security: true },
        images: [],
        isApproved: true,
        isActive: true,
        contactPhone: '0712345678',
        contactEmail: owner.email
    });

    let seenPayload = null;
    t.mock.method(axios, 'post', async (url, payload) => {
        seenPayload = payload;
        return {
            data: {
                reply: 'Grounded hostel reply',
                model: 'gemini-2.5-flash',
                provider: 'gemini',
                usedStub: false,
                suggestions: []
            }
        };
    });

    const response = await request(app)
        .post('/api/chatbot/message')
        .send({
            message: 'Are there rooms available at Riverside Executive Suites?'
        });

    assert.equal(response.status, 200);
    assert.equal(seenPayload.context.resolvedHostelMatch.name, 'Riverside Executive Suites');
    assert.equal(seenPayload.context.resolvedHostelMatch.pricePerMonth, 9200);
    assert.equal(seenPayload.context.resolvedHostelMatch.amenities.includes('wifi'), true);
});

test('chatbot request adds matched hostels for university listing prompts', { concurrency: false }, async (t) => {
    const owner = await Owner.create({
        username: 'Listing Owner',
        email: 'listing-owner@test.local',
        password: await hashPassword('Passw0rd'),
        role: 'owner',
        isEmailVerified: true,
        isApproved: true,
        businessLicense: 'private/documents/listing-license.pdf'
    });

    await Hostel.create([
        {
            name: 'Riverside Executive Suites',
            description: 'Modern rooms near campus.',
            owner: owner._id,
            location: {
                type: 'Point',
                coordinates: [37.2783, -0.4989],
                address: 'Kutus',
                city: 'Kerugoya',
                nearbyUniversity: 'Kirinyaga University'
            },
            pricePerMonth: 9200,
            hostelType: 'mixed',
            totalRooms: 30,
            availableRooms: 5,
            amenities: { wifi: true, water: true, security: true },
            images: [],
            isApproved: true,
            isActive: true,
            contactPhone: '0712345678',
            contactEmail: owner.email
        },
        {
            name: 'Campus View Residency',
            description: 'Affordable rooms close to campus.',
            owner: owner._id,
            location: {
                type: 'Point',
                coordinates: [37.2790, -0.4980],
                address: 'Kerugoya',
                city: 'Kerugoya',
                nearbyUniversity: 'Kirinyaga University'
            },
            pricePerMonth: 7600,
            hostelType: 'female',
            totalRooms: 18,
            availableRooms: 2,
            amenities: { wifi: true, laundry: true },
            images: [],
            isApproved: true,
            isActive: true,
            contactPhone: '0712345679',
            contactEmail: owner.email
        },
        {
            name: 'Kisii Corner Hostel',
            description: 'Another university listing.',
            owner: owner._id,
            location: {
                type: 'Point',
                coordinates: [34.7617, -0.6817],
                address: 'Kisii',
                city: 'Kisii',
                nearbyUniversity: 'Kisii University'
            },
            pricePerMonth: 6800,
            hostelType: 'mixed',
            totalRooms: 20,
            availableRooms: 6,
            amenities: { water: true, security: true },
            images: [],
            isApproved: true,
            isActive: true,
            contactPhone: '0712345680',
            contactEmail: owner.email
        }
    ]);

    let seenPayload = null;
    t.mock.method(axios, 'post', async (url, payload) => {
        seenPayload = payload;
        return {
            data: {
                reply: 'Grounded listing reply',
                model: 'gemini-2.5-flash',
                provider: 'gemini',
                usedStub: false,
                suggestions: []
            }
        };
    });

    const response = await request(app)
        .post('/api/chatbot/message')
        .send({
            message: 'Show hostels near Kirinyaga University'
        });

    assert.equal(response.status, 200);
    assert.equal(seenPayload.context.matchedHostelQuery.university, 'Kirinyaga University');
    assert.equal(seenPayload.context.matchedHostelQuery.totalMatches, 2);
    assert.equal(seenPayload.context.matchedHostels.length, 2);
    assert.equal(seenPayload.context.matchedHostels[0].name, 'Riverside Executive Suites');
    assert.equal(seenPayload.context.matchedHostels[1].name, 'Campus View Residency');
});

test('chatbot session fetch is blocked for a different authenticated user', { concurrency: false }, async () => {
    const owner = await Student.create({
        username: 'Session Owner',
        email: 'session-owner@student.test',
        password: await hashPassword('Passw0rd'),
        isEmailVerified: true
    });
    const otherUser = await Student.create({
        username: 'Other User',
        email: 'other-user@student.test',
        password: await hashPassword('Passw0rd'),
        isEmailVerified: true
    });

    const session = await ChatSession.create({
        userRole: 'student',
        userId: String(owner._id),
        sessionTitle: 'Private session',
        messages: [
            { role: 'user', content: 'Private question' },
            { role: 'assistant', content: 'Private answer' }
        ]
    });

    const response = await request(app)
        .get(`/api/chatbot/sessions/${session._id}`)
        .set('Authorization', `Bearer ${signToken(otherUser)}`);

    assert.equal(response.status, 403);
    assert.equal(response.body.message, 'You are not allowed to access this chat session.');
});

test('chatbot session reuse is blocked for a different authenticated user', { concurrency: false }, async () => {
    const owner = await Student.create({
        username: 'Reuse Owner',
        email: 'reuse-owner@student.test',
        password: await hashPassword('Passw0rd'),
        isEmailVerified: true
    });
    const otherUser = await Student.create({
        username: 'Reuse Other',
        email: 'reuse-other@student.test',
        password: await hashPassword('Passw0rd'),
        isEmailVerified: true
    });

    const session = await ChatSession.create({
        userRole: 'student',
        userId: String(owner._id),
        sessionTitle: 'Private session',
        messages: [
            { role: 'user', content: 'Original question' },
            { role: 'assistant', content: 'Original answer' }
        ]
    });

    const response = await request(app)
        .post('/api/chatbot/message')
        .set('Authorization', `Bearer ${signToken(otherUser)}`)
        .send({
            sessionId: String(session._id),
            message: 'Can I continue this chat?'
        });

    assert.equal(response.status, 403);
    assert.equal(response.body.message, 'You are not allowed to use this chat session.');
});
