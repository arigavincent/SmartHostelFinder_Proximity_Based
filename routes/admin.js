const router = require('express').Router();
const adminController = require('../controllers/adminController');
const adminOperationsController = require('../controllers/adminOperationsController');
const { verifyAdmin } = require('../middlewares/auth');

// All admin routes require admin authentication.
// Use `npm run seed:admin` for first-time bootstrap.
router.use(verifyAdmin);

// Admin management
router.post('/create', adminController.createAdmin);

// Dashboard
router.get('/stats', adminController.getDashboardStats);

// Owner management
router.get('/owners', adminController.getAllOwners);
router.get('/owners/pending', adminController.getPendingOwners);
router.put('/owners/:ownerId/approve', adminController.approveOwner);
router.put('/owners/:ownerId/suspend', adminController.suspendOwner);
router.put('/owners/:ownerId/verification', adminController.reviewOwnerVerification);
router.get('/owners/:ownerId/documents/:documentType', adminController.downloadOwnerDocument);
router.delete('/owners/:ownerId/reject', adminController.rejectOwner);
router.delete('/owners/:ownerId', adminController.deleteOwner);

// Hostel management
router.get('/hostels/pending', adminController.getPendingHostels);
router.put('/hostels/:hostelId/approve', adminController.approveHostel);
router.put('/hostels/:hostelId/unapprove', adminController.unapproveHostel);
router.delete('/hostels/:hostelId/reject', adminController.rejectHostel);

// User management
router.get('/students', adminController.getAllStudents);
router.delete('/students/:studentId', adminController.deleteStudent);

// Admin operations
router.get('/announcements', adminOperationsController.listAnnouncements);
router.post('/announcements', adminOperationsController.createAnnouncement);
router.put('/announcements/:id', adminOperationsController.updateAnnouncement);

router.get('/audit-logs', adminOperationsController.listAuditLogs);

router.get('/support-tickets', adminOperationsController.listSupportTickets);
router.post('/support-tickets', adminOperationsController.createSupportTicket);
router.put('/support-tickets/:id', adminOperationsController.updateSupportTicket);

router.get('/moderation', adminOperationsController.listModeration);
router.put('/moderation/:contentType/:contentId', adminOperationsController.updateModeration);

router.get('/complaints', adminOperationsController.listComplaints);
router.post('/complaints', adminOperationsController.createComplaint);
router.put('/complaints/:id', adminOperationsController.updateComplaint);

router.get('/quality-scores', adminOperationsController.getQualityScores);

router.get('/bulk-data', adminOperationsController.listBulkData);
router.post('/bulk-data/import', adminOperationsController.importBulkData);
router.post('/bulk-data/export', adminOperationsController.createExportBulkDataJob);
router.get('/bulk-data/export/:jobId/download', adminOperationsController.downloadBulkExport);

router.get('/commissions', adminOperationsController.getCommissionConfig);
router.put('/commissions', adminOperationsController.updateCommissionConfig);

router.get('/system-health', adminOperationsController.getSystemHealth);

module.exports = router;
