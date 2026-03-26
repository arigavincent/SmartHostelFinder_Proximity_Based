const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const {
    connectTestDatabase,
    clearDatabase,
    disconnectTestDatabase,
    TEST_STORAGE_ROOT
} = require('./helpers/integrationTestHelper');

const { createApp } = require('../app');
const { hashPassword } = require('../helpers/passwordHelper');
const BackgroundJob = require('../models/BackgroundJob');
const Booking = require('../models/Booking');
const Hostel = require('../models/Hostel');
const Owner = require('../models/Owners');
const Student = require('../models/Students');
const Admin = require('../models/Admin');

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
    trustProxy: false,
    jobWorkerInline: false,
    jobPollIntervalMs: 5000,
    jobConcurrency: 1,
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

test('student auth registration queues a verification email and allows login after verification', async () => {
    const registerResponse = await request(app)
        .post('/api/auth/register/student')
        .send({
            username: 'Alice Student',
            email: 'alice@student.test',
            password: 'Passw0rd'
        });

    assert.equal(registerResponse.status, 201);
    assert.equal(registerResponse.body.user.email, 'alice@student.test');

    const jobs = await BackgroundJob.find({ type: 'email' });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, 'pending');
    assert.equal(jobs[0].payload.to, 'alice@student.test');

    const blockedLogin = await request(app)
        .post('/api/auth/login')
        .send({
            email: 'alice@student.test',
            password: 'Passw0rd'
        });

    assert.equal(blockedLogin.status, 403);

    await Student.updateOne(
        { email: 'alice@student.test' },
        { $set: { isEmailVerified: true } }
    );

    const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
            email: 'alice@student.test',
            password: 'Passw0rd'
        });

    assert.equal(loginResponse.status, 200);
    assert.equal(loginResponse.body.user.role, 'student');
    assert.ok(loginResponse.body.token);
});

test('student booking flow confirms payment and exposes real booking/payment state', async () => {
    const student = await Student.create({
        username: 'Booked Student',
        email: 'booked@student.test',
        password: await hashPassword('Passw0rd'),
        isEmailVerified: true
    });
    const owner = await Owner.create({
        username: 'Booked Owner',
        email: 'owner@test.local',
        password: await hashPassword('Passw0rd'),
        role: 'owner',
        isEmailVerified: true,
        isApproved: true,
        businessLicense: 'private/documents/seed-license.pdf'
    });
    const hostel = await Hostel.create({
        name: 'Test Residency',
        description: 'Integration hostel',
        owner: owner._id,
        location: {
            type: 'Point',
            coordinates: [36.8219, -1.2921],
            address: 'Moi Avenue',
            city: 'Nairobi',
            nearbyUniversity: 'UoN'
        },
        pricePerMonth: 12000,
        hostelType: 'mixed',
        totalRooms: 20,
        availableRooms: 5,
        amenities: { wifi: true },
        images: [],
        isApproved: true,
        isActive: true,
        contactPhone: '0712345678',
        contactEmail: owner.email
    });

    const studentToken = signToken(student);

    const createResponse = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
            hostelId: String(hostel._id),
            rooms: 1,
            paymentMethod: 'card',
            startDate: '2026-05-01',
            endDate: '2026-06-01'
        });

    assert.equal(createResponse.status, 201);
    assert.equal(createResponse.body.booking.amount, 12000);

    const bookingId = createResponse.body.booking._id;
    const confirmResponse = await request(app)
        .post(`/api/bookings/${bookingId}/confirm-payment`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ paymentReference: 'CARD-TEST-001' });

    assert.equal(confirmResponse.status, 200);
    assert.equal(confirmResponse.body.confirmed, true);

    const bookingResponse = await request(app)
        .get(`/api/bookings/${bookingId}`)
        .set('Authorization', `Bearer ${studentToken}`);

    assert.equal(bookingResponse.status, 200);
    assert.equal(bookingResponse.body.status, 'confirmed');
    assert.equal(bookingResponse.body.payment.status, 'paid');
    assert.equal(bookingResponse.body.payment.reference, 'CARD-TEST-001');
    assert.ok(bookingResponse.body.receipt.receiptNumber);

    const paymentStatusResponse = await request(app)
        .get(`/api/payments/${bookingId}/status`)
        .set('Authorization', `Bearer ${studentToken}`);

    assert.equal(paymentStatusResponse.status, 200);
    assert.equal(paymentStatusResponse.body.booking.status, 'confirmed');
    assert.equal(paymentStatusResponse.body.booking.payment.status, 'paid');

    const refreshedHostel = await Hostel.findById(hostel._id);
    assert.equal(refreshedHostel.availableRooms, 4);

    const savedBooking = await Booking.findById(bookingId);
    assert.equal(savedBooking.status, 'confirmed');
});

test('student can switch a pending booking payment method to card at checkout', async () => {
    const student = await Student.create({
        username: 'Card Switch Student',
        email: 'cardswitch@student.test',
        password: await hashPassword('Passw0rd'),
        isEmailVerified: true
    });
    const owner = await Owner.create({
        username: 'Card Switch Owner',
        email: 'cardswitch-owner@test.local',
        password: await hashPassword('Passw0rd'),
        role: 'owner',
        isEmailVerified: true,
        isApproved: true,
        businessLicense: 'private/documents/card-switch-license.pdf'
    });
    const hostel = await Hostel.create({
        name: 'Card Switch Residency',
        description: 'Integration hostel',
        owner: owner._id,
        location: {
            type: 'Point',
            coordinates: [36.8219, -1.2921],
            address: 'Kenyatta Avenue',
            city: 'Nairobi',
            nearbyUniversity: 'UoN'
        },
        pricePerMonth: 9000,
        hostelType: 'mixed',
        totalRooms: 10,
        availableRooms: 3,
        amenities: { wifi: true },
        images: [],
        isApproved: true,
        isActive: true,
        contactPhone: '0712345678',
        contactEmail: owner.email
    });

    const studentToken = signToken(student);

    const createResponse = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
            hostelId: String(hostel._id),
            rooms: 1,
            paymentMethod: 'mpesa',
            startDate: '2026-05-01',
            endDate: '2026-06-01'
        });

    assert.equal(createResponse.status, 201);

    const bookingId = createResponse.body.booking._id;
    const confirmResponse = await request(app)
        .post(`/api/bookings/${bookingId}/confirm-payment`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
            paymentMethod: 'card',
            paymentReference: 'CARD-SWITCH-001'
        });

    assert.equal(confirmResponse.status, 200);
    assert.equal(confirmResponse.body.confirmed, true);

    const updatedBooking = await Booking.findById(bookingId);
    assert.equal(updatedBooking.payment.method, 'card');
    assert.equal(updatedBooking.payment.status, 'paid');
    assert.equal(updatedBooking.status, 'confirmed');
});

test('owner verification submission can be reviewed by admin and queues approval email', async () => {
    const admin = await Admin.create({
        username: 'Admin User',
        email: 'admin@test.local',
        password: await hashPassword('Passw0rd')
    });
    const adminToken = signToken(admin);

    const ownerRegistration = await request(app)
        .post('/api/auth/register/owner')
        .field('username', 'Owner Review')
        .field('email', 'owner.review@test.local')
        .field('password', 'Passw0rd')
        .attach('license', Buffer.from('%PDF-license%'), {
            filename: 'license.pdf',
            contentType: 'application/pdf'
        });

    assert.equal(ownerRegistration.status, 201);

    const owner = await Owner.findOne({ email: 'owner.review@test.local' });
    await Owner.updateOne(
        { _id: owner._id },
        { $set: { isEmailVerified: true } }
    );

    const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
            email: 'owner.review@test.local',
            password: 'Passw0rd'
        });

    assert.equal(loginResponse.status, 200);
    const ownerToken = loginResponse.body.token;

    const verificationResponse = await request(app)
        .post('/api/owners/verification')
        .set('Authorization', `Bearer ${ownerToken}`)
        .field('fullName', 'Owner Review')
        .field('idNumber', '12345678')
        .field('phone', '0711223344')
        .field('businessName', 'Review Homes')
        .field('registrationNumber', 'BN-100')
        .field('kraPin', 'A123456789B')
        .attach('idDocument', Buffer.from('%PDF-id%'), {
            filename: 'id.pdf',
            contentType: 'application/pdf'
        })
        .attach('businessCertificate', Buffer.from('%PDF-business%'), {
            filename: 'business.pdf',
            contentType: 'application/pdf'
        })
        .attach('propertyProof', Buffer.from('%PDF-property%'), {
            filename: 'property.pdf',
            contentType: 'application/pdf'
        });

    assert.equal(verificationResponse.status, 200);
    assert.equal(verificationResponse.body.verification.status, 'submitted');

    const pendingOwnersResponse = await request(app)
        .get('/api/admin/owners/pending')
        .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(pendingOwnersResponse.status, 200);
    assert.equal(pendingOwnersResponse.body.total, 1);

    const reviewResponse = await request(app)
        .put(`/api/admin/owners/${owner._id}/verification`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'approve' });

    assert.equal(reviewResponse.status, 200);
    assert.equal(reviewResponse.body.verification.status, 'approved');

    const refreshedOwner = await Owner.findById(owner._id);
    assert.equal(refreshedOwner.isApproved, true);
    assert.equal(refreshedOwner.verification.status, 'approved');

    const approvalJobs = await BackgroundJob.find({ type: 'email' }).sort({ createdAt: 1 });
    assert.equal(approvalJobs.length, 2);
    assert.equal(approvalJobs[1].payload.subject, 'Account Approved - SmartHostelFinder');

    const storedFiles = fs.readdirSync(path.join(TEST_STORAGE_ROOT, 'private', 'documents'));
    assert.ok(storedFiles.length > 0);
});
