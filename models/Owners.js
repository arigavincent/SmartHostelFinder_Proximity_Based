const mongoose = require('mongoose');

const OwnerSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String },
    role: { type: String, default: 'owner' },
    businessLicense: { type: String, required: true }, 
    isApproved: { type: Boolean, default: false },
    hostels: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Hostel' }],
    
    // Email verification
    isEmailVerified: { type: Boolean, default: false },
    emailVerificationToken: { type: String },
    emailVerificationExpires: { type: Date },
    
    // Password reset
    passwordResetToken: { type: String },
    passwordResetExpires: { type: Date },
    
    // Google OAuth
    googleId: { type: String },
    authProvider: { type: String, enum: ['local', 'google'], default: 'local' }
}, { timestamps: true });

module.exports = mongoose.model('Owner', OwnerSchema);
