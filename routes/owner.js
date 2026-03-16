const router = require('express').Router();
const ownerController = require('../controllers/ownerController');
const ownerOperationsController = require('../controllers/ownerOperationsController');
const { verifyOwner } = require('../middlewares/auth');
const upload = require('../utils/multer');

// All routes require owner authentication
router.use(verifyOwner);

// Profile
router.get('/profile', ownerController.getProfile);
router.put('/profile', ownerController.updateProfile);
router.get('/announcements', ownerController.getAnnouncements);
router.post('/announcements/:announcementId/read', ownerController.markAnnouncementRead);
router.get('/verification', ownerController.getVerification);
router.post(
    '/verification',
    upload.fields([
        { name: 'idDocument', maxCount: 1 },
        { name: 'businessCertificate', maxCount: 1 },
        { name: 'taxComplianceCertificate', maxCount: 1 },
        { name: 'propertyProof', maxCount: 1 }
    ]),
    ownerController.submitVerification
);
router.get('/verification/documents/:documentType', ownerController.downloadVerificationDocument);

// Hostels
router.get('/hostels', ownerController.getMyHostels);
router.get('/stats', ownerController.getHostelStats);
router.put('/rooms', ownerController.updateRoomAvailability);

// Owner operations
router.get('/maintenance', ownerOperationsController.listMaintenance);
router.post('/maintenance', ownerOperationsController.createMaintenance);
router.put('/maintenance/:id', ownerOperationsController.updateMaintenance);

router.get('/leases', ownerOperationsController.listLeases);
router.post('/leases', ownerOperationsController.createLease);
router.put('/leases/:id', ownerOperationsController.updateLease);

router.get('/expenses', ownerOperationsController.listExpenses);
router.post('/expenses', ownerOperationsController.createExpense);
router.delete('/expenses/:id', ownerOperationsController.deleteExpense);

router.get('/caretakers', ownerOperationsController.listCaretakers);
router.post('/caretakers', ownerOperationsController.createCaretaker);
router.put('/caretakers/:id', ownerOperationsController.updateCaretaker);
router.delete('/caretakers/:id', ownerOperationsController.deleteCaretaker);

router.get('/conversations', ownerOperationsController.listConversations);
router.post('/conversations', ownerOperationsController.createConversation);
router.post('/conversations/:id/messages', ownerOperationsController.sendConversationMessage);
router.put('/conversations/:id/read', ownerOperationsController.markConversationRead);

router.get('/checklists', ownerOperationsController.listChecklists);
router.post('/checklists', ownerOperationsController.createChecklist);
router.put('/checklists/:id', ownerOperationsController.updateChecklist);
router.get('/checklists/:id/report', ownerOperationsController.downloadChecklistReport);

router.get('/marketing', ownerOperationsController.listMarketing);
router.post('/marketing/:hostelId/boost', ownerOperationsController.boostListing);
router.post('/marketing/:hostelId/share', ownerOperationsController.shareListing);

router.get('/revenue-report', ownerOperationsController.getRevenueReport);
router.get('/revenue-report/export', ownerOperationsController.exportRevenueReport);

module.exports = router;
