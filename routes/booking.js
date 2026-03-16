const router = require('express').Router();
const bookingController = require('../controllers/bookingController');
const { verifyStudent, verifyOwner, verifyAdmin, verifyToken } = require('../middlewares/auth');

// Student routes
router.post('/', verifyStudent, bookingController.createBooking);
router.post('/:id/confirm-payment', verifyStudent, bookingController.confirmPayment);
router.post('/:id/verify-mpesa', verifyStudent, bookingController.verifyMpesaPayment);
router.post('/:id/cancel', verifyStudent, bookingController.cancelBooking);
router.get('/me', verifyStudent, bookingController.listMyBookings);

// Owner routes
router.get('/owner', verifyOwner, bookingController.listOwnerBookings);
router.post('/:id/release', verifyOwner, bookingController.releasePendingBookingByOwner);

// Admin routes
router.get('/admin', verifyAdmin, bookingController.listAdminBookings);

// Receipt download (student/owner/admin)
router.get('/:id', verifyToken, bookingController.getBookingById);
router.get('/:id/receipt', verifyToken, bookingController.downloadReceipt);

// Single booking lookup — must be after all named routes
router.get('/:id', verifyToken, bookingController.getBookingById);

module.exports = router;
