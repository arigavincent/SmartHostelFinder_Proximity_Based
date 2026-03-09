const router = require('express').Router();
const authController = require('../controllers/authController');
const { verifyToken } = require('../middlewares/auth');
const { uploadLicense } = require('../utils/multer');

// Registration
router.post('/register/student', authController.registerStudent);
router.post('/register/owner', uploadLicense.single('license'), authController.registerOwner);

// Login
router.post('/login', authController.login);

// Google OAuth
router.post('/google', authController.googleLogin);

// Email Verification
router.post('/verify-email', authController.verifyEmail);
router.post('/resend-verification', authController.resendVerificationEmail);

// Password Reset
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

// Profile (protected)
router.get('/profile', verifyToken, authController.getProfile);

module.exports = router;
