const mongoose = require('mongoose');
const dns = require('dns');

// Node.js on Windows can fail to resolve MongoDB Atlas SRV records via the
// system DNS. Explicitly using Google DNS fixes this.
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const connectDB = async () => {
    const uri = process.env.MONGO_URI || process.env.MONGO_URL;
    if (!uri) {
        console.error('No MongoDB URI configured. Set MONGO_URI or MONGO_URL in .env');
        process.exit(1);
    }
    try {
        const conn = await mongoose.connect(uri);
        console.log(`MongoDB Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error(`Database connection error: ${error.message}`);
        process.exit(1);
    }
};

module.exports = connectDB;
