const router = require('express').Router();
const paymentController = require('../controllers/paymentController');
const { verifyToken, verifyStudent } = require('../middlewares/auth');

// Student payment initialization
router.post('/initialize', verifyStudent, paymentController.initializePayment);

// Booking payment status (student/owner/admin with controller-level access checks)
router.get('/:bookingId/status', verifyToken, paymentController.getBookingPaymentStatus);

// Provider webhook callback (public, signature-verified)
router.post('/webhook/:provider', paymentController.handleWebhook);

module.exports = router;
