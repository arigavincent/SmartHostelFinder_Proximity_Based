const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('./config/db');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();

// Connect to Database
connectDB();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files for uploads
app.use('/uploads', express.static('uploads'));

// Import Routes
const authRoutes = require('./routes/auth');
const hostelRoutes = require('./routes/hostel');
const studentRoutes = require('./routes/student');
const ownerRoutes = require('./routes/owner');
const adminRoutes = require('./routes/admin');
const bookingRoutes = require('./routes/booking');

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/hostels', hostelRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/owners', ownerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/bookings', bookingRoutes);

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
            bookings: '/api/bookings'
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
    res.status(500).json({ message: 'Internal server error', error: err.message });
});

// Start server
const PORT = process.env.PORT || 5100;
app.listen(PORT, () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`📡 API available at http://localhost:${PORT}`);
});
