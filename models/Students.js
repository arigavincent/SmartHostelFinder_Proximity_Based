const mongoose = require('mongoose');

const StudentSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String },
    role: { type: String, default: 'student' },
    phone: { type: String, trim: true },
    favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Hostel' }],
    
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

module.exports = mongoose.model('Student', StudentSchema);
