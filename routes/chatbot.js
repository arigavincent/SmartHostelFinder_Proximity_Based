const router = require('express').Router();
const chatbotController = require('../controllers/chatbotController');
const { optionalToken } = require('../middlewares/auth');

router.get('/sessions/:sessionId', optionalToken, chatbotController.getSession);
router.post('/message', optionalToken, chatbotController.sendMessage);

module.exports = router;
