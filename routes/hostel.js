const router = require('express').Router();
const hostelController = require('../controllers/hostelController');
const { verifyOwner, verifyStudent, verifyOwnerOrAdmin, optionalToken } = require('../middlewares/auth');
const { uploadImages } = require('../utils/multer');

// Public routes
router.get('/', hostelController.getAllHostels);
router.get('/search/proximity', hostelController.searchByProximity);
router.get('/:id', optionalToken, hostelController.getHostelById);

// Owner routes
router.post('/', verifyOwner, uploadImages.array('images', 10), hostelController.createHostel);
router.post('/:id/images', verifyOwnerOrAdmin, uploadImages.array('images', 10), hostelController.uploadHostelImages);
router.put('/:id', verifyOwnerOrAdmin, hostelController.updateHostel);
router.delete('/:id/images', verifyOwnerOrAdmin, hostelController.deleteHostelImage);
router.delete('/:id', verifyOwnerOrAdmin, hostelController.deleteHostel);

// Student routes
router.post('/:id/rating', verifyStudent, hostelController.addRating);

module.exports = router;
