const router = require('express').Router();
const ownerController = require('../controllers/ownerController');
const { verifyOwner } = require('../middlewares/auth');

// All routes require owner authentication
router.use(verifyOwner);

// Profile
router.get('/profile', ownerController.getProfile);
router.put('/profile', ownerController.updateProfile);

// Hostels
router.get('/hostels', ownerController.getMyHostels);
router.get('/stats', ownerController.getHostelStats);
router.put('/rooms', ownerController.updateRoomAvailability);

module.exports = router;
