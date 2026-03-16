const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const TEST_STORAGE_ROOT = path.resolve(__dirname, '..', '..', 'storage-test');

let mongoServer;

const setTestEnv = () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret';
    process.env.JWT_EXPIRES_IN = '30d';
    process.env.CLIENT_URL = 'http://localhost:3000';
    process.env.SERVER_URL = 'http://localhost:5100';
    process.env.STORAGE_PROVIDER = 'local';
    process.env.STORAGE_LOCAL_ROOT = TEST_STORAGE_ROOT;
    process.env.JOB_WORKER_INLINE = 'false';
    process.env.SMTP_HOST = 'smtp.test.local';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'test@example.com';
    process.env.SMTP_PASS = 'not-used';
    process.env.MONGOMS_DOWNLOAD_DIR = '/tmp/mongodb-binaries';
};

setTestEnv();

const connectTestDatabase = async () => {
    setTestEnv();
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    process.env.MONGO_URI = mongoUri;
    await mongoose.connect(mongoUri);
};

const clearDatabase = async () => {
    const collections = mongoose.connection.collections;
    await Promise.all(
        Object.values(collections).map((collection) => collection.deleteMany({}))
    );
    fs.rmSync(TEST_STORAGE_ROOT, { recursive: true, force: true });
};

const disconnectTestDatabase = async () => {
    await mongoose.disconnect();
    if (mongoServer) {
        await mongoServer.stop();
        mongoServer = null;
    }
    fs.rmSync(TEST_STORAGE_ROOT, { recursive: true, force: true });
};

module.exports = {
    TEST_STORAGE_ROOT,
    setTestEnv,
    connectTestDatabase,
    clearDatabase,
    disconnectTestDatabase
};
