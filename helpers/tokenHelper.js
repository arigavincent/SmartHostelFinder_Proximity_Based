const crypto = require('crypto');

/**
 * Generate a random token for email verification or password reset
 * @returns {string} - Random hex token
 */
const generateToken = () => {
    return crypto.randomBytes(32).toString('hex');
};

/**
 * Generate token hash for secure storage
 * @param {string} token - Plain token
 * @returns {string} - Hashed token
 */
const hashToken = (token) => {
    return crypto.createHash('sha256').update(token).digest('hex');
};

module.exports = {
    generateToken,
    hashToken
};
