const mongoose = require('mongoose');
const dns = require('dns');
const { logger } = require('../helpers/logger');
const Hostel = require('../models/Hostel');

// Node.js on Windows can fail to resolve MongoDB Atlas SRV records via the
// system DNS. Explicitly using public DNS resolvers is more reliable.
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const connectDB = async () => {
    const uri = process.env.MONGO_URI || process.env.MONGO_URL;
    if (!uri) {
        console.error('No MongoDB URI configured. Set MONGO_URI or MONGO_URL in .env');
        process.exit(1);
    }
    try {
        mongoose.set('strictQuery', true);
        const conn = await mongoose.connect(uri, {
            serverSelectionTimeoutMS: 10000,
            maxPoolSize: 20
        });
        logger.info('database.connected', {
            host: conn.connection.host,
            name: conn.connection.name
        });

        await Hostel.syncIndexes();
        logger.info('database.indexes_synced', {
            model: 'Hostel'
        });

        mongoose.connection.on('error', (error) => {
            logger.error('database.error', { error: error.message });
        });

        mongoose.connection.on('disconnected', () => {
            logger.warn('database.disconnected');
        });
    } catch (error) {
        logger.error('database.connection_failed', { error: error.message });
        process.exit(1);
    }
};

module.exports = connectDB;
