const router = require('express').Router();
const bookingController = require('../controllers/bookingController');
const { verifyStudent, verifyOwner, verifyAdmin, verifyToken } = require('../middlewares/auth');

// Student routes
router.post('/', verifyStudent, bookingController.createBooking);
router.post('/:id/confirm-payment', verifyStudent, bookingController.confirmPayment);
router.post('/:id/cancel', verifyStudent, bookingController.cancelBooking);
router.get('/me', verifyStudent, bookingController.listMyBookings);

// Owner routes
router.get('/owner', verifyOwner, bookingController.listOwnerBookings);

// Admin routes
router.get('/admin', verifyAdmin, bookingController.listAdminBookings);

// Receipt download (student/owner/admin)
router.get('/:id/receipt', verifyToken, bookingController.downloadReceipt);

module.exports = router;
