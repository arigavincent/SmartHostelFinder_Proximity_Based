const Owner = require('../models/Owners');
const Hostel = require('../models/Hostel');
const Announcement = require('../models/Announcement');
const AnnouncementRead = require('../models/AnnouncementRead');
const {
    generateObjectKey,
    sendDownload,
    saveBuffer
} = require('../services/storageService');

const ownerAnnouncementFilter = {
    status: 'sent',
    audience: { $in: ['all', 'owners'] }
};

const serializeAnnouncementsForUser = (announcements, readMap) => announcements.map((announcement) => {
    const readRecord = readMap.get(String(announcement._id));
    return {
        _id: announcement._id,
        title: announcement.title,
        message: announcement.message,
        audience: announcement.audience,
        publishedAt: announcement.publishedAt,
        createdAt: announcement.createdAt,
        viewCount: announcement.viewCount || 0,
        isRead: Boolean(readRecord),
        readAt: readRecord?.readAt || null
    };
});

const emptyVerification = () => ({
    status: 'not_submitted',
    rejectionReason: '',
    submittedAt: null,
    reviewedAt: null,
    personalInfo: {
        fullName: '',
        idNumber: '',
        phone: ''
    },
    businessInfo: {
        name: '',
        registrationNumber: '',
        kraPin: ''
    },
    documents: {
        idDocument: '',
        businessCertificate: '',
        taxComplianceCertificate: '',
        propertyProof: ''
    }
});

const buildDocumentUrl = (documentPath) => {
    if (!documentPath) return '';
    return String(documentPath);
};

const serializeVerification = (verification) => {
    const value = verification || emptyVerification();
    return {
        status: value.status || 'not_submitted',
        rejectionReason: value.rejectionReason || '',
        submittedAt: value.submittedAt || null,
        reviewedAt: value.reviewedAt || null,
        personalInfo: {
            fullName: value.personalInfo?.fullName || '',
            idNumber: value.personalInfo?.idNumber || '',
            phone: value.personalInfo?.phone || ''
        },
        businessInfo: {
            name: value.businessInfo?.name || '',
            registrationNumber: value.businessInfo?.registrationNumber || '',
            kraPin: value.businessInfo?.kraPin || ''
        },
        documents: {
            idDocument: buildDocumentUrl(value.documents?.idDocument),
            businessCertificate: buildDocumentUrl(value.documents?.businessCertificate),
            taxComplianceCertificate: buildDocumentUrl(value.documents?.taxComplianceCertificate),
            propertyProof: buildDocumentUrl(value.documents?.propertyProof)
        }
    };
};

exports.serializeVerification = serializeVerification;

// Get owner profile
exports.getProfile = async (req, res) => {
    try {
        const owner = await Owner.findById(req.user.id)
            .select('-password')
            .populate('hostels');
        
        if (!owner) {
            return res.status(404).json({ message: 'Owner not found.' });
        }
        
        res.status(200).json(owner);
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Update owner profile
exports.updateProfile = async (req, res) => {
    try {
        const updates = {};

        if (req.body.username !== undefined) {
            updates.username = String(req.body.username).trim();
        }

        if (req.body.phone !== undefined) {
            updates.phone = String(req.body.phone).trim();
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ message: 'No valid profile fields provided.' });
        }
        
        const updatedOwner = await Owner.findByIdAndUpdate(
            req.user.id,
            { $set: updates },
            { new: true }
        ).select('-password');
        
        res.status(200).json({
            message: 'Profile updated successfully.',
            owner: updatedOwner
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Get owner verification details
exports.getVerification = async (req, res) => {
    try {
        const owner = await Owner.findById(req.user.id).select('username email phone verification');

        if (!owner) {
            return res.status(404).json({ message: 'Owner not found.' });
        }

        res.status(200).json({
            verification: serializeVerification(owner.verification),
            profile: {
                username: owner.username,
                email: owner.email,
                phone: owner.phone || ''
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Submit owner verification
exports.submitVerification = async (req, res) => {
    try {
        const owner = await Owner.findById(req.user.id);
        if (!owner) {
            return res.status(404).json({ message: 'Owner not found.' });
        }

        const fullName = String(req.body.fullName || '').trim();
        const idNumber = String(req.body.idNumber || '').trim();
        const phone = String(req.body.phone || '').trim();
        const businessName = String(req.body.businessName || '').trim();
        const registrationNumber = String(req.body.registrationNumber || '').trim();
        const kraPin = String(req.body.kraPin || '').trim();

        if (!fullName || !idNumber || !phone || !businessName) {
            return res.status(400).json({
                message: 'Full name, ID number, phone, and business name are required.'
            });
        }

        const currentVerification = owner.verification || emptyVerification();
        const uploadedFiles = req.files || {};
        const storeDocument = async (fieldName, fallbackValue) => {
            const file = uploadedFiles[fieldName]?.[0];
            if (!file?.buffer) {
                return fallbackValue || '';
            }

            const key = generateObjectKey(`private/documents/${req.user.id}`, file.originalname);
            await saveBuffer({
                key,
                buffer: file.buffer,
                contentType: file.mimetype
            });
            return key;
        };
        const documents = {
            idDocument: await storeDocument('idDocument', currentVerification.documents?.idDocument),
            businessCertificate: await storeDocument('businessCertificate', currentVerification.documents?.businessCertificate || owner.businessLicense),
            taxComplianceCertificate: await storeDocument('taxComplianceCertificate', currentVerification.documents?.taxComplianceCertificate),
            propertyProof: await storeDocument('propertyProof', currentVerification.documents?.propertyProof)
        };

        if (!documents.idDocument || !documents.businessCertificate || !documents.propertyProof) {
            return res.status(400).json({
                message: 'ID document, business certificate, and property proof are required.'
            });
        }

        owner.phone = phone;
        owner.verification = {
            status: 'submitted',
            rejectionReason: '',
            submittedAt: new Date(),
            reviewedAt: null,
            personalInfo: {
                fullName,
                idNumber,
                phone
            },
            businessInfo: {
                name: businessName,
                registrationNumber,
                kraPin
            },
            documents
        };

        await owner.save();

        res.status(200).json({
            message: 'Verification submitted successfully.',
            verification: serializeVerification(owner.verification)
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Download owner verification document
exports.downloadVerificationDocument = async (req, res) => {
    try {
        const allowedDocumentTypes = [
            'idDocument',
            'businessCertificate',
            'taxComplianceCertificate',
            'propertyProof'
        ];
        const { documentType } = req.params;

        if (!allowedDocumentTypes.includes(documentType)) {
            return res.status(400).json({ message: 'Invalid document type.' });
        }

        const owner = await Owner.findById(req.user.id).select('verification');
        if (!owner) {
            return res.status(404).json({ message: 'Owner not found.' });
        }

        const storedPath = owner.verification?.documents?.[documentType];
        if (!storedPath) {
            return res.status(404).json({ message: 'Document not found.' });
        }

        return sendDownload(res, storedPath);
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Get published announcements for owners
exports.getAnnouncements = async (req, res) => {
    try {
        const announcements = await Announcement.find(ownerAnnouncementFilter)
            .sort({ publishedAt: -1, createdAt: -1 })
            .limit(10)
            .select('title message audience publishedAt createdAt viewCount');

        const reads = await AnnouncementRead.find({
            userRole: 'owner',
            userId: req.user.id,
            announcement: { $in: announcements.map((announcement) => announcement._id) }
        }).select('announcement readAt');

        const readMap = new Map(reads.map((read) => [String(read.announcement), read]));
        const serialized = serializeAnnouncementsForUser(announcements, readMap);

        res.status(200).json({
            announcements: serialized,
            unreadCount: serialized.filter((announcement) => !announcement.isRead).length
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.markAnnouncementRead = async (req, res) => {
    try {
        const announcement = await Announcement.findOne({
            _id: req.params.announcementId,
            ...ownerAnnouncementFilter
        });

        if (!announcement) {
            return res.status(404).json({ message: 'Announcement not found.' });
        }

        const existing = await AnnouncementRead.findOne({
            announcement: announcement._id,
            userRole: 'owner',
            userId: req.user.id
        });

        if (!existing) {
            await AnnouncementRead.create({
                announcement: announcement._id,
                userRole: 'owner',
                userId: req.user.id
            });

            await Announcement.findByIdAndUpdate(announcement._id, {
                $inc: { viewCount: 1 }
            });
        }

        res.status(200).json({ message: 'Announcement marked as read.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Get owner's hostels
exports.getMyHostels = async (req, res) => {
    try {
        const hostels = await Hostel.find({ owner: req.user.id });
        
        res.status(200).json({
            total: hostels.length,
            hostels
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Get hostel statistics
exports.getHostelStats = async (req, res) => {
    try {
        const hostels = await Hostel.find({ owner: req.user.id });
        
        const stats = {
            totalHostels: hostels.length,
            approvedHostels: hostels.filter(h => h.isApproved).length,
            pendingHostels: hostels.filter(h => !h.isApproved).length,
            totalRooms: hostels.reduce((sum, h) => sum + h.totalRooms, 0),
            availableRooms: hostels.reduce((sum, h) => sum + h.availableRooms, 0),
            averageRating: hostels.length > 0 
                ? hostels.reduce((sum, h) => sum + h.averageRating, 0) / hostels.length 
                : 0
        };
        
        res.status(200).json(stats);
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Update room availability
exports.updateRoomAvailability = async (req, res) => {
    try {
        const { hostelId, availableRooms } = req.body;
        
        const hostel = await Hostel.findById(hostelId);
        
        if (!hostel) {
            return res.status(404).json({ message: 'Hostel not found.' });
        }
        
        if (hostel.owner.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized.' });
        }
        
        if (availableRooms > hostel.totalRooms) {
            return res.status(400).json({ message: 'Available rooms cannot exceed total rooms.' });
        }
        
        hostel.availableRooms = availableRooms;
        await hostel.save();
        
        res.status(200).json({
            message: 'Room availability updated.',
            hostel
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};
