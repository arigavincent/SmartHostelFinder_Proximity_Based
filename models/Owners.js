const mongoose = require('mongoose');

const OwnerVerificationSchema = new mongoose.Schema({
    status: {
        type: String,
        enum: ['not_submitted', 'submitted', 'approved', 'rejected'],
        default: 'not_submitted'
    },
    rejectionReason: { type: String },
    submittedAt: { type: Date },
    reviewedAt: { type: Date },
    personalInfo: {
        fullName: { type: String },
        idNumber: { type: String },
        phone: { type: String }
    },
    businessInfo: {
        name: { type: String },
        registrationNumber: { type: String },
        kraPin: { type: String }
    },
    documents: {
        idDocument: { type: String },
        businessCertificate: { type: String },
        taxComplianceCertificate: { type: String },
        propertyProof: { type: String }
    }
}, { _id: false });

const OwnerSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String },
    role: { type: String, default: 'owner' },
    phone: { type: String, trim: true },
    businessLicense: { 
        type: String,
        required: function requiredBusinessLicense() {
            return this.authProvider !== 'google';
        }
    }, 
    isApproved: { type: Boolean, default: false },
    isSuspended: { type: Boolean, default: false },
    verification: { type: OwnerVerificationSchema, default: () => ({}) },
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
