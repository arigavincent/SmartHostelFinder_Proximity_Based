const os = require('os');
const mongoose = require('mongoose');
const Announcement = require('../models/Announcement');
const AuditLog = require('../models/AuditLog');
const Booking = require('../models/Booking');
const BackgroundJob = require('../models/BackgroundJob');
const CommissionConfig = require('../models/CommissionConfig');
const Complaint = require('../models/Complaint');
const Hostel = require('../models/Hostel');
const ModerationDecision = require('../models/ModerationDecision');
const Owner = require('../models/Owners');
const PaymentTransaction = require('../models/PaymentTransaction');
const Student = require('../models/Students');
const SupportTicket = require('../models/SupportTicket');
const Admin = require('../models/Admin');
const { logAdminAction } = require('../helpers/auditLogHelper');
const { enqueueJob } = require('../services/jobQueueService');
const { checkHealth, sendDownload } = require('../services/storageService');
const {
    determineCommissionRate
} = require('../helpers/adminOperationsHelper');

const forbiddenReviewTerms = ['stupid', 'idiot', 'scam', 'fraud', 'abuse', 'hate'];

const getCommissionConfig = async () => {
    let config = await CommissionConfig.findOne();
    if (!config) {
        config = await CommissionConfig.create({});
    }
    return config;
};

const buildModerationItems = async () => {
    const [hostels, decisions] = await Promise.all([
        Hostel.find().populate('owner', 'username'),
        ModerationDecision.find()
    ]);

    const decisionMap = new Map(decisions.map((decision) => [`${decision.contentType}:${decision.contentId}`, decision]));
    const items = [];

    hostels.forEach((hostel) => {
        const suspiciousPrice = Number(hostel.pricePerMonth || 0) > 50000 || Number(hostel.pricePerMonth || 0) < 2000;
        const contentKey = `listing:${hostel._id}`;
        const decision = decisionMap.get(contentKey);

        if (suspiciousPrice || decision) {
          items.push({
              id: String(hostel._id),
              type: 'listing',
              title: hostel.name,
              owner: hostel.owner?.username || 'Unknown owner',
              reason: decision?.reason || (hostel.pricePerMonth > 50000 ? 'Auto-flagged: suspiciously high pricing' : 'Auto-flagged: suspiciously low pricing'),
              status: decision?.status || 'flagged',
              date: (decision?.updatedAt || hostel.updatedAt).toISOString()
          });
        }

        hostel.ratings.forEach((rating) => {
            const reviewText = String(rating.review || '').toLowerCase();
            const isFlagged = forbiddenReviewTerms.some((term) => reviewText.includes(term));
            const reviewId = String(rating._id);
            const reviewKey = `review:${reviewId}`;
            const reviewDecision = decisionMap.get(reviewKey);

            if (isFlagged || reviewDecision) {
                items.push({
                    id: reviewId,
                    type: 'review',
                    hostelId: String(hostel._id),
                    title: `Review on ${hostel.name}`,
                    owner: 'Student',
                    reason: reviewDecision?.reason || 'Auto-flagged: inappropriate language',
                    status: reviewDecision?.status || 'pending',
                    date: (reviewDecision?.updatedAt || rating.createdAt || hostel.updatedAt).toISOString()
                });
            }
        });
    });

    return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

const measureService = async (name, checkFn) => {
    const start = Date.now();
    try {
        const detail = await checkFn();
        return {
            name,
            status: detail.status || 'healthy',
            uptime: detail.uptime || '100.00%',
            responseTime: `${Date.now() - start}ms`,
            detail: detail.detail || ''
        };
    } catch (error) {
        return {
            name,
            status: 'down',
            uptime: '0.00%',
            responseTime: `${Date.now() - start}ms`,
            detail: error.message
        };
    }
};

exports.listAnnouncements = async (req, res) => {
    try {
        const announcements = await Announcement.find().sort({ createdAt: -1 });
        res.status(200).json({ announcements });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.createAnnouncement = async (req, res) => {
    try {
        const { title, message, audience, status } = req.body;
        if (!title || !message) {
            return res.status(400).json({ message: 'Title and message are required.' });
        }

        const announcement = await Announcement.create({
            title: String(title).trim(),
            message: String(message).trim(),
            audience: audience || 'all',
            status: status || 'draft',
            publishedAt: status === 'sent' ? new Date() : undefined,
            createdBy: req.user.id
        });

        await logAdminAction({
            adminId: req.user.id,
            adminEmail: req.user.email,
            action: status === 'sent' ? 'Announcement Published' : 'Announcement Drafted',
            target: announcement.title,
            type: 'announcement'
        });

        res.status(201).json({ message: 'Announcement saved successfully.', announcement });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.updateAnnouncement = async (req, res) => {
    try {
        const announcement = await Announcement.findById(req.params.id);
        if (!announcement) {
            return res.status(404).json({ message: 'Announcement not found.' });
        }

        ['title', 'message', 'audience', 'status'].forEach((field) => {
            if (req.body[field] !== undefined) {
                announcement[field] = typeof req.body[field] === 'string' ? req.body[field].trim() : req.body[field];
            }
        });

        if (announcement.status === 'sent' && !announcement.publishedAt) {
            announcement.publishedAt = new Date();
        }

        await announcement.save();

        await logAdminAction({
            adminId: req.user.id,
            adminEmail: req.user.email,
            action: 'Announcement Updated',
            target: announcement.title,
            type: 'announcement'
        });

        res.status(200).json({ message: 'Announcement updated successfully.', announcement });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.listAuditLogs = async (req, res) => {
    try {
        const search = String(req.query.search || '').trim().toLowerCase();
        const type = String(req.query.type || '').trim();
        const allLogs = await AuditLog.find().sort({ createdAt: -1 }).limit(500);
        const logs = allLogs.filter((log) => {
            if (type && type !== 'all' && log.type !== type) return false;
            if (!search) return true;
            const target = `${log.action} ${log.target} ${log.actorEmail || ''}`.toLowerCase();
            return target.includes(search);
        });
        res.status(200).json({ logs });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.listSupportTickets = async (req, res) => {
    try {
        const tickets = await SupportTicket.find().sort({ updatedAt: -1 });
        res.status(200).json({
            tickets,
            stats: {
                open: tickets.filter((ticket) => ticket.status === 'open').length,
                in_progress: tickets.filter((ticket) => ticket.status === 'in_progress').length,
                resolved: tickets.filter((ticket) => ticket.status === 'resolved').length
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.createSupportTicket = async (req, res) => {
    try {
        const { subject, userEmail, userRole, priority, message } = req.body;
        if (!subject || !userEmail || !userRole || !message) {
            return res.status(400).json({ message: 'Subject, user email, role, and message are required.' });
        }

        const ticket = await SupportTicket.create({
            subject: String(subject).trim(),
            userEmail: String(userEmail).trim(),
            userRole,
            priority: priority || 'medium',
            replies: [{ sender: 'user', message: String(message).trim() }]
        });

        await logAdminAction({
            adminId: req.user.id,
            adminEmail: req.user.email,
            action: 'Support Ticket Created',
            target: ticket.subject,
            type: 'support'
        });

        res.status(201).json({ message: 'Support ticket created successfully.', ticket });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.updateSupportTicket = async (req, res) => {
    try {
        const ticket = await SupportTicket.findById(req.params.id);
        if (!ticket) {
            return res.status(404).json({ message: 'Support ticket not found.' });
        }

        if (req.body.status !== undefined) {
            ticket.status = req.body.status;
        }

        if (req.body.adminReply) {
            ticket.replies.push({ sender: 'admin', message: String(req.body.adminReply).trim() });
        }

        await ticket.save();

        await logAdminAction({
            adminId: req.user.id,
            adminEmail: req.user.email,
            action: 'Support Ticket Updated',
            target: ticket.subject,
            type: 'support'
        });

        res.status(200).json({ message: 'Support ticket updated successfully.', ticket });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.listModeration = async (req, res) => {
    try {
        const items = await buildModerationItems();
        res.status(200).json({
            items,
            stats: {
                flagged: items.filter((item) => item.status === 'flagged').length,
                pending: items.filter((item) => item.status === 'pending').length,
                approved: items.filter((item) => item.status === 'approved').length,
                removed: items.filter((item) => item.status === 'removed').length
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.updateModeration = async (req, res) => {
    try {
        const { contentType, contentId } = req.params;
        const action = String(req.body.action || '').trim();
        const reason = String(req.body.reason || '').trim();

        if (!['approve', 'remove'].includes(action)) {
            return res.status(400).json({ message: 'Invalid moderation action.' });
        }

        if (contentType === 'listing') {
            const hostel = await Hostel.findById(contentId);
            if (!hostel) {
                return res.status(404).json({ message: 'Listing not found.' });
            }
            if (action === 'remove') {
                hostel.isActive = false;
                await hostel.save();
            }
        } else if (contentType === 'review') {
            const hostels = await Hostel.find({ 'ratings._id': contentId });
            const hostel = hostels[0];
            if (!hostel) {
                return res.status(404).json({ message: 'Review not found.' });
            }
            if (action === 'remove') {
                hostel.ratings = hostel.ratings.filter((rating) => String(rating._id) !== String(contentId));
                const totalRatings = hostel.ratings.reduce((sum, rating) => sum + Number(rating.rating || 0), 0);
                hostel.averageRating = hostel.ratings.length > 0 ? totalRatings / hostel.ratings.length : 0;
                await hostel.save();
            }
        } else {
            return res.status(400).json({ message: 'Invalid content type.' });
        }

        await ModerationDecision.findOneAndUpdate(
            { contentType, contentId },
            {
                $set: {
                    status: action === 'approve' ? 'approved' : 'removed',
                    reason,
                    actionedBy: req.user.id
                }
            },
            { upsert: true, new: true }
        );

        await logAdminAction({
            adminId: req.user.id,
            adminEmail: req.user.email,
            action: action === 'approve' ? 'Moderation Approved' : 'Moderation Removed',
            target: `${contentType}:${contentId}`,
            type: 'moderation'
        });

        res.status(200).json({ message: 'Moderation decision saved successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.listComplaints = async (req, res) => {
    try {
        const complaints = await Complaint.find().sort({ updatedAt: -1 });
        res.status(200).json({
            complaints,
            stats: {
                open: complaints.filter((item) => item.status === 'open').length,
                investigating: complaints.filter((item) => item.status === 'investigating').length,
                resolved: complaints.filter((item) => item.status === 'resolved').length
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.createComplaint = async (req, res) => {
    try {
        const { subject, studentName, ownerName, hostelName, details, priority } = req.body;
        if (!subject || !studentName || !ownerName || !hostelName) {
            return res.status(400).json({ message: 'Subject, student, owner, and hostel are required.' });
        }

        const complaint = await Complaint.create({
            subject: String(subject).trim(),
            studentName: String(studentName).trim(),
            ownerName: String(ownerName).trim(),
            hostelName: String(hostelName).trim(),
            details: String(details || '').trim(),
            priority: priority || 'medium'
        });

        await logAdminAction({
            adminId: req.user.id,
            adminEmail: req.user.email,
            action: 'Complaint Created',
            target: complaint.subject,
            type: 'complaint'
        });

        res.status(201).json({ message: 'Complaint logged successfully.', complaint });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.updateComplaint = async (req, res) => {
    try {
        const complaint = await Complaint.findById(req.params.id);
        if (!complaint) {
            return res.status(404).json({ message: 'Complaint not found.' });
        }

        ['status', 'notes', 'priority'].forEach((field) => {
            if (req.body[field] !== undefined) {
                complaint[field] = typeof req.body[field] === 'string' ? req.body[field].trim() : req.body[field];
            }
        });

        await complaint.save();

        await logAdminAction({
            adminId: req.user.id,
            adminEmail: req.user.email,
            action: 'Complaint Updated',
            target: complaint.subject,
            type: 'complaint'
        });

        res.status(200).json({ message: 'Complaint updated successfully.', complaint });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.getQualityScores = async (req, res) => {
    try {
        const hostels = await Hostel.find().select('name averageRating ratings pricePerMonth availableRooms totalRooms isApproved isActive');
        const scores = hostels.map((hostel) => {
            const reviewCount = hostel.ratings.length;
            const ratingScore = Math.min(100, Number(hostel.averageRating || 0) * 20);
            const occupancyScore = hostel.totalRooms > 0
                ? ((hostel.totalRooms - hostel.availableRooms) / hostel.totalRooms) * 20
                : 0;
            const approvalScore = hostel.isApproved && hostel.isActive ? 15 : 0;
            const reviewVolumeScore = Math.min(15, reviewCount * 0.8);
            const score = Math.round(Math.min(100, ratingScore + occupancyScore + approvalScore + reviewVolumeScore));

            return {
                name: hostel.name,
                score,
                reviews: reviewCount,
                trend: score >= 80 ? 'up' : score >= 65 ? 'stable' : 'down'
            };
        }).sort((a, b) => b.score - a.score);

        const averageScore = scores.length > 0
            ? Number((scores.reduce((sum, item) => sum + item.score, 0) / scores.length).toFixed(1))
            : 0;

        res.status(200).json({
            scores,
            summary: {
                averageScore,
                topRated: scores[0]?.name || 'N/A',
                belowThreshold: scores.filter((item) => item.score < 70).length
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.listBulkData = async (req, res) => {
    try {
        const jobs = await BackgroundJob.find({
            type: { $in: ['bulk_import', 'bulk_export'] }
        }).sort({ createdAt: -1 }).limit(25);

        const serializedJobs = jobs.map((job) => ({
            _id: job._id,
            type: job.type === 'bulk_import' ? 'import' : 'export',
            dataType: job.type === 'bulk_import'
                ? job.payload?.dataType
                : job.payload?.exportType,
            fileName: job.type === 'bulk_import'
                ? (job.payload?.fileName || '')
                : (job.result?.fileName || `${job.payload?.exportType || 'export'}-export.csv`),
            status: job.status,
            summary: job.result?.summary || { created: 0, skipped: 0, failed: 0 },
            errorMessages: job.result?.errorMessages || (job.errorMessage ? [job.errorMessage] : []),
            downloadUrl: job.type === 'bulk_export' && job.result?.storageKey
                ? `/api/admin/bulk-data/export/${job._id}/download`
                : '',
            createdAt: job.createdAt,
            completedAt: job.completedAt
        }));

        res.status(200).json({
            imports: serializedJobs.filter((job) => job.type === 'import'),
            jobs: serializedJobs
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.importBulkData = async (req, res) => {
    try {
        const { dataType, fileName, csvText } = req.body;
        if (!dataType || !csvText) {
            return res.status(400).json({ message: 'Data type and CSV content are required.' });
        }

        const job = await enqueueJob({
            type: 'bulk_import',
            createdBy: req.user.id,
            createdByModel: 'Admin',
            maxAttempts: 1,
            priority: 8,
            payload: {
                dataType,
                fileName: String(fileName || '').trim(),
                csvText
            }
        });

        await logAdminAction({
            adminId: req.user.id,
            adminEmail: req.user.email,
            action: 'Bulk Import Queued',
            target: `${dataType}:${fileName || 'inline'}`,
            type: 'bulk'
        });

        res.status(202).json({
            message: 'Bulk import job queued.',
            job
        });
    } catch (error) {
        res.status(400).json({ message: error.message || 'Server error.' });
    }
};

exports.createExportBulkDataJob = async (req, res) => {
    try {
        const type = String(req.body.type || '').trim();
        if (!type) {
            return res.status(400).json({ message: 'Export type is required.' });
        }

        const job = await enqueueJob({
            type: 'bulk_export',
            createdBy: req.user.id,
            createdByModel: 'Admin',
            maxAttempts: 2,
            priority: 8,
            payload: {
                exportType: type
            }
        });

        await logAdminAction({
            adminId: req.user.id,
            adminEmail: req.user.email,
            action: 'Bulk Export Queued',
            target: type,
            type: 'bulk'
        });

        res.status(202).json({
            message: 'Bulk export job queued.',
            job
        });
    } catch (error) {
        res.status(400).json({ message: error.message || 'Server error.' });
    }
};

exports.downloadBulkExport = async (req, res) => {
    try {
        const job = await BackgroundJob.findOne({
            _id: req.params.jobId,
            type: 'bulk_export'
        });

        if (!job) {
            return res.status(404).json({ message: 'Export job not found.' });
        }

        if (job.status !== 'completed' || !job.result?.storageKey) {
            return res.status(409).json({ message: 'Export job is not ready for download.' });
        }

        await sendDownload(res, job.result.storageKey, job.result.fileName);
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.getCommissionConfig = async (req, res) => {
    try {
        const [config, ownerHostelCounts, monthPayments] = await Promise.all([
            getCommissionConfig(),
            Hostel.aggregate([{ $group: { _id: '$owner', hostels: { $sum: 1 } } }]),
            PaymentTransaction.find({
                status: 'succeeded',
                createdAt: {
                    $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
                }
            }).select('owner amount')
        ]);

        const hostelCountMap = new Map(ownerHostelCounts.map((item) => [String(item._id), item.hostels]));
        const totalEarned = monthPayments.reduce((sum, payment) => {
            const hostelCount = hostelCountMap.get(String(payment.owner)) || 0;
            const rate = determineCommissionRate(hostelCount, config);
            return sum + (Number(payment.amount || 0) * rate) / 100;
        }, 0);

        const owners = await Owner.countDocuments({ isApproved: true });
        const tiers = config.tiers.map((tier) => ({
            rangeLabel: tier.rangeLabel,
            minHostels: tier.minHostels,
            maxHostels: tier.maxHostels,
            rate: tier.rate,
            owners: ownerHostelCounts.filter((item) => item.hostels >= tier.minHostels && (tier.maxHostels === null || item.hostels <= tier.maxHostels)).length
        }));

        res.status(200).json({
            defaultRate: config.defaultRate,
            tiers,
            summary: {
                totalEarned: Number(totalEarned.toFixed(2)),
                activeOwners: owners
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.updateCommissionConfig = async (req, res) => {
    try {
        const config = await getCommissionConfig();
        if (req.body.defaultRate !== undefined) {
            config.defaultRate = Number(req.body.defaultRate);
        }
        if (Array.isArray(req.body.tiers)) {
            config.tiers = req.body.tiers.map((tier) => ({
                rangeLabel: String(tier.rangeLabel).trim(),
                minHostels: Number(tier.minHostels),
                maxHostels: tier.maxHostels === null || tier.maxHostels === '' ? null : Number(tier.maxHostels),
                rate: Number(tier.rate)
            }));
        }
        config.updatedBy = req.user.id;
        await config.save();

        await logAdminAction({
            adminId: req.user.id,
            adminEmail: req.user.email,
            action: 'Commission Config Updated',
            target: `${config.defaultRate}% default`,
            type: 'settings'
        });

        res.status(200).json({ message: 'Commission config updated successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.getSystemHealth = async (req, res) => {
    try {
        const services = await Promise.all([
            measureService('API Server', async () => ({
                status: 'healthy',
                uptime: `${(100).toFixed(2)}%`
            })),
            measureService('Database (MongoDB)', async () => {
                await mongoose.connection.db.admin().ping();
                return { status: 'healthy', uptime: '100.00%' };
            }),
            measureService('Object Storage', async () => {
                const storage = await checkHealth();
                return {
                    status: 'healthy',
                    uptime: '100.00%',
                    detail: `${storage.provider}:${storage.detail}`
                };
            }),
            measureService('Payment Gateway', async () => {
                const hasEnv = process.env.SERVER_URL && process.env.SAFARICOM_CONSUMER_KEY && process.env.SAFARICOM_CONSUMER_SECRET;
                return {
                    status: hasEnv ? 'healthy' : 'warning',
                    uptime: hasEnv ? '100.00%' : '95.00%',
                    detail: hasEnv ? '' : 'M-Pesa environment incomplete.'
                };
            }),
            measureService('Email Service', async () => {
                const hasEmailEnv = process.env.EMAIL_HOST || process.env.SMTP_HOST;
                return {
                    status: hasEmailEnv ? 'healthy' : 'warning',
                    uptime: hasEmailEnv ? '100.00%' : '90.00%',
                    detail: hasEmailEnv ? '' : 'SMTP environment incomplete.'
                };
            })
        ]);

        const uptimeHours = Math.min(24, Math.floor(process.uptime() / 3600));
        const uptimeData = Array.from({ length: 24 }, (_, index) => {
            const active = index >= 24 - uptimeHours;
            return {
                hour: `${index}:00`,
                uptime: active ? 100 : 0
            };
        });

        const dbStats = await mongoose.connection.db.stats();
        const healthyServices = services.filter((service) => service.status === 'healthy').length;

        res.status(200).json({
            summary: {
                overallUptime: `${healthyServices === services.length ? '100.00' : '99.00'}%`,
                avgResponse: services.reduce((sum, service) => sum + Number(service.responseTime.replace('ms', '')), 0) / services.length,
                servicesUp: `${healthyServices}/${services.length}`,
                dbSizeGb: Number(((dbStats.dataSize || 0) / (1024 * 1024 * 1024)).toFixed(2))
            },
            uptimeData,
            services,
            system: {
                hostname: os.hostname(),
                platform: os.platform(),
                memoryUsageMb: Math.round(process.memoryUsage().rss / (1024 * 1024))
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};
