const router = require('express').Router();
const hostelController = require('../controllers/hostelController');
const { verifyToken, verifyOwner, verifyStudent, verifyOwnerOrAdmin } = require('../middlewares/auth');
const { uploadImages } = require('../utils/multer');

// Public routes
router.get('/', hostelController.getAllHostels);
router.get('/search/proximity', hostelController.searchByProximity);
router.get('/:id', hostelController.getHostelById);

// Owner routes
router.post('/', verifyOwner, uploadImages.array('images', 10), hostelController.createHostel);
router.put('/:id', verifyOwnerOrAdmin, hostelController.updateHostel);
router.delete('/:id', verifyOwnerOrAdmin, hostelController.deleteHostel);

// Image management
router.post('/:id/images', verifyOwner, uploadImages.array('images', 10), hostelController.uploadHostelImages);
router.delete('/:id/images', verifyOwnerOrAdmin, hostelController.deleteHostelImage);

// Student routes
router.post('/:id/rating', verifyStudent, hostelController.addRating);

module.exports = router;
