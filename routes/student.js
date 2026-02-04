const router = require('express').Router();
const studentController = require('../controllers/studentController');
const { verifyStudent } = require('../middlewares/auth');

// All routes require student authentication
router.use(verifyStudent);

// Profile
router.get('/profile', studentController.getProfile);
router.put('/profile', studentController.updateProfile);

// Favorites
router.get('/favorites', studentController.getFavorites);
router.post('/favorites/:hostelId', studentController.addToFavorites);
router.delete('/favorites/:hostelId', studentController.removeFromFavorites);

module.exports = router;
