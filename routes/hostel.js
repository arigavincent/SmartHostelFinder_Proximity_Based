const router = require('express').Router();
const hostelController = require('../controllers/hostelController');
const { verifyToken, verifyOwner, verifyStudent, verifyOwnerOrAdmin } = require('../middlewares/auth');
const upload = require('../utils/multer');

// Public routes
router.get('/', hostelController.getAllHostels);
router.get('/search/proximity', hostelController.searchByProximity);
router.get('/:id', hostelController.getHostelById);

// Owner routes
router.post('/', verifyOwner, upload.array('images', 10), hostelController.createHostel);
router.put('/:id', verifyOwnerOrAdmin, hostelController.updateHostel);
router.delete('/:id', verifyOwnerOrAdmin, hostelController.deleteHostel);

// Student routes
router.post('/:id/rating', verifyStudent, hostelController.addRating);

module.exports = router;
