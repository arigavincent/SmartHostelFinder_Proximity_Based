const router = require('express').Router();
const adminController = require('../controllers/adminController');
const { verifyAdmin } = require('../middlewares/auth');

// Admin creation (unprotected - for initial setup only)
router.post('/create', adminController.createAdmin);

// All routes below require admin authentication
router.use(verifyAdmin);

// Dashboard
router.get('/stats', adminController.getDashboardStats);

// Owner management
router.get('/owners', adminController.getAllOwners);
router.get('/owners/pending', adminController.getPendingOwners);
router.put('/owners/:ownerId/approve', adminController.approveOwner);
router.delete('/owners/:ownerId/reject', adminController.rejectOwner);

// Hostel management
router.get('/hostels/pending', adminController.getPendingHostels);
router.put('/hostels/:hostelId/approve', adminController.approveHostel);
router.delete('/hostels/:hostelId/reject', adminController.rejectHostel);

// User management
router.get('/students', adminController.getAllStudents);

module.exports = router;
