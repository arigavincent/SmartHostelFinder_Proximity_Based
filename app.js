const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { requestContext } = require('./middlewares/requestContext');
const { notFoundHandler, errorHandler } = require('./middlewares/errorHandler');
const { metricsMiddleware, renderPrometheusMetrics } = require('./services/metricsService');
const BackgroundJob = require('./models/BackgroundJob');

const authRoutes = require('./routes/auth');
const hostelRoutes = require('./routes/hostel');
const studentRoutes = require('./routes/student');
const ownerRoutes = require('./routes/owner');
const adminRoutes = require('./routes/admin');
const bookingRoutes = require('./routes/booking');
const paymentRoutes = require('./routes/payment');
const storageRoutes = require('./routes/storage');

const createApp = (env) => {
    const app = express();

    app.disable('x-powered-by');
    if (env.trustProxy) {
        app.set('trust proxy', 1);
    }

    const allowedOrigins = new Set(env.corsOrigins);
    const corsOptions = {
        origin(origin, callback) {
            if (!origin || allowedOrigins.has(origin)) {
                return callback(null, true);
            }

            const error = new Error('Origin not allowed by CORS');
            error.statusCode = 403;
            return callback(error);
        }
    };

    const globalRateLimiter = rateLimit({
        windowMs: env.rateLimitWindowMs,
        limit: env.rateLimitMax,
        standardHeaders: true,
        legacyHeaders: false,
        handler(req, res) {
            res.status(429).json({
                message: 'Too many requests. Please try again later.',
                requestId: req.requestId
            });
        }
    });

    const authRateLimiter = rateLimit({
        windowMs: env.rateLimitWindowMs,
        limit: env.authRateLimitMax,
        standardHeaders: true,
        legacyHeaders: false,
        handler(req, res) {
            res.status(429).json({
                message: 'Too many authentication attempts. Please try again later.',
                requestId: req.requestId
            });
        }
    });

    app.use(requestContext);
    app.use(metricsMiddleware);
    app.use(helmet({
        contentSecurityPolicy: false,
        crossOriginResourcePolicy: { policy: 'cross-origin' }
    }));
    app.use(cors(corsOptions));
    app.use(globalRateLimiter);
    app.use(express.json({ limit: env.bodyLimit }));
    app.use(express.urlencoded({ extended: true, limit: env.bodyLimit }));

    app.use('/api/auth', authRateLimiter, authRoutes);
    app.use('/api/hostels', hostelRoutes);
    app.use('/api/students', studentRoutes);
    app.use('/api/owners', ownerRoutes);
    app.use('/api/admin', adminRoutes);
    app.use('/api/bookings', bookingRoutes);
    app.use('/api/payments', paymentRoutes);
    app.use('/api/storage', storageRoutes);

    app.get('/api/health', (req, res) => {
        res.status(200).json({
            status: 'OK',
            message: 'SmartHostelFinder API is running',
            environment: env.nodeEnv,
            uptimeSeconds: Math.round(process.uptime()),
            requestId: req.requestId
        });
    });

    app.get('/', (req, res) => {
        res.json({
            message: 'Welcome to SmartHostelFinder API',
            version: '1.0.0',
            endpoints: {
                auth: '/api/auth',
                hostels: '/api/hostels',
                students: '/api/students',
                owners: '/api/owners',
                admin: '/api/admin',
                bookings: '/api/bookings',
                payments: '/api/payments'
            }
        });
    });

    app.get('/api/metrics', async (req, res) => {
        const token = String(process.env.METRICS_TOKEN || '').trim();
        if (token) {
            const suppliedToken = req.get('x-metrics-token') || req.query.token;
            if (suppliedToken !== token) {
                return res.status(403).json({ message: 'Metrics access denied.' });
            }
        }

        const body = await renderPrometheusMetrics({ BackgroundJob });
        res.setHeader('Content-Type', 'text/plain; version=0.0.4');
        res.status(200).send(body);
    });

    app.use(notFoundHandler);
    app.use(errorHandler);

    return app;
};

module.exports = { createApp };
