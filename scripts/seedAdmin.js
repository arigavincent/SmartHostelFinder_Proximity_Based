const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Admin = require('../models/Admin');
const { hashPassword } = require('../helpers/passwordHelper');

// Load environment variables
dotenv.config();

// Default admin credentials (change these in production)
const DEFAULT_ADMIN = {
    username: 'admin',
    email: 'admin@smarthostelfinder.com',
    password: 'Admin@123'
};

const seedAdmin = async () => {
    try {
        // Connect to database
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB...');

        // Check if admin already exists
        const existingAdmin = await Admin.findOne({ 
            $or: [
                { email: DEFAULT_ADMIN.email }, 
                { username: DEFAULT_ADMIN.username }
            ] 
        });

        if (existingAdmin) {
            console.log('Admin already exists:');
            console.log(`  Username: ${existingAdmin.username}`);
            console.log(`  Email: ${existingAdmin.email}`);
            console.log('\nNo new admin created.');
        } else {
            // Hash password and create admin
            const hashedPassword = await hashPassword(DEFAULT_ADMIN.password);

            const admin = new Admin({
                username: DEFAULT_ADMIN.username,
                email: DEFAULT_ADMIN.email,
                password: hashedPassword
            });

            await admin.save();

            console.log('Admin created successfully!');
            console.log('-----------------------------');
            console.log(`  Username: ${DEFAULT_ADMIN.username}`);
            console.log(`  Email: ${DEFAULT_ADMIN.email}`);
            console.log(`  Password: ${DEFAULT_ADMIN.password}`);
            console.log('-----------------------------');
            console.log('\n⚠️  Please change the password after first login!');
        }

    } catch (error) {
        console.error('Error seeding admin:', error.message);
    } finally {
        await mongoose.connection.close();
        console.log('\nDatabase connection closed.');
        process.exit(0);
    }
};

// Run the seeder
seedAdmin();
