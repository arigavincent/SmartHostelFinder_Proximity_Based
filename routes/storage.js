const router = require('express').Router();
const storageController = require('../controllers/storageController');

router.get('/public', storageController.getPublicObject);
router.get('/download', storageController.downloadObject);

module.exports = router;
