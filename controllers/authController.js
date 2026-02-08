const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { hashPassword, comparePassword } = require('../helpers/passwordHelper');
const { generateToken: generateRandomToken, hashToken } = require('../helpers/tokenHelper');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../helpers/emailHelper');
const { 
    validateStudentRegistration, 
    validateOwnerRegistration, 
    validateLogin,
    validatePasswordReset,
    validateEmail 
} = require('../helpers/validationHelper');
const Student = require('../models/Students');
const Owner = require('../models/Owners');
const Admin = require('../models/Admin');

// Google OAuth client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Generate JWT Token
const generateToken = (user) => {
    const expiresIn = process.env.JWT_EXPIRES_IN || '30d';
    return jwt.sign(
        { id: user._id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn }
    );
};

// Student Registration
exports.registerStudent = async (req, res) => {
    try {
        const { username, email, password } = req.body;
        
        // Validate input fields
        const validation = validateStudentRegistration({ username, email, password });
        if (!validation.isValid) {
            return res.status(400).json({ message: 'Validation failed.', errors: validation.errors });
        }
        
        // Check if email already exists
        const existingStudentEmail = await Student.findOne({ email });
        if (existingStudentEmail) {
            return res.status(400).json({ message: 'Email already registered.' });
        }
        
        // Check if username already exists
        const existingStudentUsername = await Student.findOne({ username });
        if (existingStudentUsername) {
            return res.status(400).json({ message: 'Username already taken.' });
        }
        
        // Hash password
        const hashedPassword = await hashPassword(password);
        
        // Generate email verification token
        const verificationToken = generateRandomToken();
        const hashedVerificationToken = hashToken(verificationToken);
        
        // Create student
        const student = new Student({
            username,
            email,
            password: hashedPassword,
            emailVerificationToken: hashedVerificationToken,
            emailVerificationExpires: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
        });
        
        const savedStudent = await student.save();
        
        // Send verification email
        try {
            await sendVerificationEmail(email, username, verificationToken);
        } catch (emailError) {
            console.error('Email sending failed:', emailError.message);
        }
        
        res.status(201).json({
            message: 'Student registered. Please check your email to verify your account.',
            user: { id: savedStudent._id, username: savedStudent.username, email: savedStudent.email }
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Owner Registration
exports.registerOwner = async (req, res) => {
    try {
        const { username, email, password } = req.body;
        const businessLicense = req.file ? req.file.path : null;
        
        // Validate input fields (including license check)
        const validation = validateOwnerRegistration({ username, email, password }, !!req.file);
        if (!validation.isValid) {
            return res.status(400).json({ message: 'Validation failed.', errors: validation.errors });
        }
        
        // Check if email already exists
        const existingOwnerEmail = await Owner.findOne({ email });
        if (existingOwnerEmail) {
            return res.status(400).json({ message: 'Email already registered.' });
        }
        
        // Check if username already exists
        const existingOwnerUsername = await Owner.findOne({ username });
        if (existingOwnerUsername) {
            return res.status(400).json({ message: 'Username already taken.' });
        }
        
        // Hash password
        const hashedPassword = await hashPassword(password);
        
        // Generate email verification token
        const verificationToken = generateRandomToken();
        const hashedVerificationToken = hashToken(verificationToken);
        
        // Create owner
        const owner = new Owner({
            username,
            email,
            password: hashedPassword,
            businessLicense,
            emailVerificationToken: hashedVerificationToken,
            emailVerificationExpires: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
        });
        
        const savedOwner = await owner.save();
        
        // Send verification email
        try {
            await sendVerificationEmail(email, username, verificationToken);
        } catch (emailError) {
            console.error('Email sending failed:', emailError.message);
        }
        
        res.status(201).json({
            message: 'Owner registered. Please verify your email. Admin approval pending.',
            user: { id: savedOwner._id, username: savedOwner.username, email: savedOwner.email }
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Universal Login
exports.login = async (req, res) => {
    try {
        const { email, username, password } = req.body;
        
        // Validate input fields
        const validation = validateLogin({ email, username, password });
        if (!validation.isValid) {
            return res.status(400).json({ message: 'Validation failed.', errors: validation.errors });
        }
        
        // Check all user collections
        // Students login with email only
        let user = await Student.findOne({ email });
        
        // Owners can login with email or username
        if (!user) {
            user = email 
                ? await Owner.findOne({ email }) 
                : await Owner.findOne({ username });
        }
        
        // Admins can login with email or username
        if (!user) {
            user = email 
                ? await Admin.findOne({ email }) 
                : await Admin.findOne({ username });
        }
        
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }
        
        // Check if email is verified (for students and owners)
        if ((user.role === 'student' || user.role === 'owner') && !user.isEmailVerified) {
            return res.status(403).json({ 
                message: 'Please verify your email before logging in.',
                email: user.email
            });
        }
        
        // Check if owner is approved
        if (user.role === 'owner' && !user.isApproved) {
            return res.status(403).json({ message: 'Account pending admin approval.' });
        }
        
        // Verify password
        const validPassword = await comparePassword(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }
        
        // Generate token
        const token = generateToken(user);
        
        res.status(200).json({
            message: 'Login successful.',
            token,
            user: { id: user._id, username: user.username, email: user.email, role: user.role }
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Get current user profile
exports.getProfile = async (req, res) => {
    try {
        let user;
        
        switch (req.user.role) {
            case 'student':
                user = await Student.findById(req.user.id).select('-password').populate('favorites');
                break;
            case 'owner':
                user = await Owner.findById(req.user.id).select('-password').populate('hostels');
                break;
            case 'admin':
                user = await Admin.findById(req.user.id).select('-password');
                break;
            default:
                return res.status(400).json({ message: 'Invalid user role.' });
        }
        
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }
        
        res.status(200).json(user);
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Verify Email
exports.verifyEmail = async (req, res) => {
    try {
        const { token } = req.body;
        
        if (!token) {
            return res.status(400).json({ message: 'Verification token is required.' });
        }
        
        const hashedToken = hashToken(token);
        
        // Search in both Student and Owner collections
        let user = await Student.findOne({
            emailVerificationToken: hashedToken,
            emailVerificationExpires: { $gt: Date.now() }
        });
        
        if (!user) {
            user = await Owner.findOne({
                emailVerificationToken: hashedToken,
                emailVerificationExpires: { $gt: Date.now() }
            });
        }
        
        if (!user) {
            return res.status(400).json({ message: 'Invalid or expired verification token.' });
        }
        
        user.isEmailVerified = true;
        user.emailVerificationToken = undefined;
        user.emailVerificationExpires = undefined;
        await user.save();
        
        res.status(200).json({ message: 'Email verified successfully. You can now login.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Resend Verification Email
exports.resendVerificationEmail = async (req, res) => {
    try {
        const { email } = req.body;

        const emailValidation = validateEmail(email);
        if (!emailValidation.isValid) {
            return res.status(400).json({ message: emailValidation.error });
        }
        
        // Search in both Student and Owner collections
        let user = await Student.findOne({ email });
        if (!user) {
            user = await Owner.findOne({ email });
        }
        
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }
        
        if (user.isEmailVerified) {
            return res.status(400).json({ message: 'Email is already verified.' });
        }
        
        // Generate new token
        const verificationToken = generateRandomToken();
        user.emailVerificationToken = hashToken(verificationToken);
        user.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000;
        await user.save();
        
        await sendVerificationEmail(email, user.username, verificationToken);
        
        res.status(200).json({ message: 'Verification email sent.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Forgot Password
exports.forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;

        const emailValidation = validateEmail(email);
        if (!emailValidation.isValid) {
            return res.status(400).json({ message: emailValidation.error });
        }
        
        // Check all user types
        let user = await Student.findOne({ email });
        let userType = 'student';
        
        if (!user) {
            user = await Owner.findOne({ email });
            userType = 'owner';
        }
        
        if (!user) {
            user = await Admin.findOne({ email });
            userType = 'admin';
        }
        
        if (!user) {
            return res.status(404).json({ message: 'No account found with this email.' });
        }
        
        // Generate reset token
        const resetToken = generateRandomToken();
        user.passwordResetToken = hashToken(resetToken);
        user.passwordResetExpires = Date.now() + 60 * 60 * 1000; // 1 hour
        await user.save();
        
        // Send reset email
        await sendPasswordResetEmail(email, user.username, resetToken);
        
        res.status(200).json({ 
            message: 'Password reset link sent to your email.',
            userType 
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Reset Password
exports.resetPassword = async (req, res) => {
    try {
        const { token, password, userType } = req.body;

        const validation = validatePasswordReset({ token, password });
        if (!validation.isValid) {
            return res.status(400).json({ message: 'Validation failed.', errors: validation.errors });
        }
        
        const hashedToken = hashToken(token);
        
        // Determine model based on userType or search all
        let user;
        if (userType === 'student') {
            user = await Student.findOne({
                passwordResetToken: hashedToken,
                passwordResetExpires: { $gt: Date.now() }
            });
        } else if (userType === 'owner') {
            user = await Owner.findOne({
                passwordResetToken: hashedToken,
                passwordResetExpires: { $gt: Date.now() }
            });
        } else if (userType === 'admin') {
            user = await Admin.findOne({
                passwordResetToken: hashedToken,
                passwordResetExpires: { $gt: Date.now() }
            });
        } else {
            // Search all models
            user = await Student.findOne({ passwordResetToken: hashedToken, passwordResetExpires: { $gt: Date.now() } });
            if (!user) user = await Owner.findOne({ passwordResetToken: hashedToken, passwordResetExpires: { $gt: Date.now() } });
            if (!user) user = await Admin.findOne({ passwordResetToken: hashedToken, passwordResetExpires: { $gt: Date.now() } });
        }
        
        if (!user) {
            return res.status(400).json({ message: 'Invalid or expired reset token.' });
        }
        
        // Update password
        user.password = await hashPassword(password);
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;
        await user.save();
        
        res.status(200).json({ message: 'Password reset successful. You can now login.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Google Sign-In
exports.googleLogin = async (req, res) => {
    try {
        const { credential, userType } = req.body;
        
        if (!credential) {
            return res.status(400).json({ message: 'Google credential is required.' });
        }
        
        // Verify Google token
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID
        });
        
        const payload = ticket.getPayload();
        const { sub: googleId, email, name, email_verified } = payload;
        
        if (!email_verified) {
            return res.status(400).json({ message: 'Google email not verified.' });
        }
        
        if (userType && userType !== 'student' && userType !== 'owner') {
            return res.status(400).json({ message: 'Invalid user type for Google login.' });
        }

        const Model = userType === 'owner' ? Owner : Student;
        
        // Check if user exists
        let user = await Model.findOne({ $or: [{ googleId }, { email }] });
        
        if (user) {
            // Update Google ID if not set
            if (!user.googleId) {
                user.googleId = googleId;
                user.authProvider = 'google';
                user.isEmailVerified = true;
                await user.save();
            }
        } else {
            // Create new user
            user = new Model({
                username: name,
                email,
                googleId,
                authProvider: 'google',
                isEmailVerified: true
            });
            await user.save();
        }
        
        // Check owner approval
        if (user.role === 'owner' && !user.isApproved) {
            return res.status(403).json({ 
                message: 'Account pending admin approval.',
                user: { id: user._id, email: user.email }
            });
        }
        
        // Generate JWT
        const jwtToken = generateToken(user);
        
        res.status(200).json({
            message: 'Google login successful.',
            token: jwtToken,
            user: { id: user._id, username: user.username, email: user.email, role: user.role }
        });
    } catch (error) {
        res.status(500).json({ message: 'Google authentication failed.' });
    }
};
