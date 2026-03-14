const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const connectDB = require('./config/db');
const cron = require('node-cron');
const axios = require('axios');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve only public hostel images. Keep owner documents private.
app.use('/uploads/images', express.static(path.join(__dirname, 'uploads/images')));

// Import Routes
const authRoutes = require('./routes/auth');
const hostelRoutes = require('./routes/hostel');
const studentRoutes = require('./routes/student');
const ownerRoutes = require('./routes/owner');
const adminRoutes = require('./routes/admin');
const bookingRoutes = require('./routes/booking');
const paymentRoutes = require('./routes/payment');

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/hostels', hostelRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/owners', ownerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/payments', paymentRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'SmartHostelFinder API is running' });
});

// Root endpoint
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

// 404 handler
app.use((req, res) => {
    res.status(404).json({ message: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: 'Internal server error' });
});

const PORT = process.env.PORT || 5100;

// Start only after DB connection is ready.
const startServer = async () => {
    try {
        await connectDB();
        app.listen(PORT, () => {
            console.log(`\n🚀 Server running on port ${PORT}`);
            console.log(`📡 API available at http://localhost:${PORT}`);

            // Cron job to keep Render instance awake
            const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;
            
            cron.schedule('*/3 * * * *', async () => {
                try {
                    const response = await axios.get(`${SERVER_URL}/api/health`);
                    console.log(`[Cron] Keep-alive ping successful: ${response.data.status}`);
                } catch (error) {
                    console.error('[Cron] Keep-alive ping failed:', error.message);
                }
            });
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();