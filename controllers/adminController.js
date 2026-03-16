const Admin = require('../models/Admin');
const Owner = require('../models/Owners');
const Student = require('../models/Students');
const Hostel = require('../models/Hostel');
const Booking = require('../models/Booking');
const PaymentTransaction = require('../models/PaymentTransaction');
const { hashPassword } = require('../helpers/passwordHelper');
const { validateAdminCreation } = require('../helpers/validationHelper');
const { serializeVerification } = require('./ownerController');
const { logAdminAction } = require('../helpers/auditLogHelper');
const { buildApprovalEmail } = require('../helpers/emailHelper');
const { enqueueJob } = require('../services/jobQueueService');
const { sendDownload } = require('../services/storageService');

const releaseStudentRooms = async (studentId) => {
    const activeBookings = await Booking.find({
        student: studentId,
        status: { $ne: 'cancelled' }
    }).select('hostel roomsBooked');

    await Promise.all(
        activeBookings.map((booking) =>
            Hostel.findByIdAndUpdate(booking.hostel, {
                $inc: { availableRooms: booking.roomsBooked }
            })
        )
    );
};

// Get all pending owner approvals
exports.getPendingOwners = async (req, res) => {
    try {
        const pendingOwners = await Owner.find({ 'verification.status': 'submitted' })
            .select('-password');
        
        res.status(200).json({
            total: pendingOwners.length,
            owners: pendingOwners
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Approve owner
exports.approveOwner = async (req, res) => {
    try {
        const owner = await Owner.findById(req.params.ownerId);

        if (!owner) {
            return res.status(404).json({ message: 'Owner not found.' });
        }

        if (owner.verification?.status === 'submitted' || owner.verification?.status === 'rejected') {
            owner.verification.status = 'approved';
            owner.verification.reviewedAt = new Date();
            owner.verification.rejectionReason = '';
        }

        owner.isApproved = true;
        owner.isSuspended = false;
        await owner.save();

        const sanitizedOwner = await Owner.findById(owner._id).select('-password');

        await enqueueJob({
            type: 'email',
            payload: buildApprovalEmail(owner.email, owner.username, true),
            createdBy: req.user.id,
            createdByModel: 'Admin',
            maxAttempts: 5,
            priority: 6
        });

        res.status(200).json({
            message: 'Owner approved successfully.',
            owner: sanitizedOwner
        });

        await logAdminAction({
            adminId: req.user.id,
            adminEmail: req.user.email,
            action: 'Owner Approved',
            target: sanitizedOwner.email || sanitizedOwner.username,
            type: 'approval'
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Suspend owner
exports.suspendOwner = async (req, res) => {
    try {
        const owner = await Owner.findByIdAndUpdate(
            req.params.ownerId,
            { $set: { isSuspended: true } },
            { new: true }
        ).select('-password');

        if (!owner) {
            return res.status(404).json({ message: 'Owner not found.' });
        }

        res.status(200).json({
            message: 'Owner suspended successfully.',
            owner
        });

        await logAdminAction({
            adminId: req.user.id,
            adminEmail: req.user.email,
            action: 'Owner Suspended',
            target: owner.email || owner.username,
            type: 'moderation'
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Review owner verification
exports.reviewOwnerVerification = async (req, res) => {
    try {
        const owner = await Owner.findById(req.params.ownerId).select('-password');

        if (!owner) {
            return res.status(404).json({ message: 'Owner not found.' });
        }

        const action = String(req.body.action || '').trim().toLowerCase();
        const rejectionReason = String(req.body.rejectionReason || '').trim();

        if (action !== 'approve' && action !== 'reject') {
            return res.status(400).json({ message: 'Action must be approve or reject.' });
        }

        if (action === 'reject' && !rejectionReason) {
            return res.status(400).json({ message: 'Rejection reason is required.' });
        }

        if (!owner.verification || owner.verification.status === 'not_submitted') {
            return res.status(400).json({ message: 'Owner has not submitted verification.' });
        }

        owner.verification.status = action === 'approve' ? 'approved' : 'rejected';
        owner.verification.reviewedAt = new Date();
        owner.verification.rejectionReason = action === 'approve' ? '' : rejectionReason;
        owner.isApproved = action === 'approve';
        owner.isSuspended = false;
        await owner.save();

        await enqueueJob({
            type: 'email',
            payload: buildApprovalEmail(owner.email, owner.username, action === 'approve', rejectionReason),
            createdBy: req.user.id,
            createdByModel: 'Admin',
            maxAttempts: 5,
            priority: 6
        });

        res.status(200).json({
            message: action === 'approve'
                ? 'Owner verification approved successfully.'
                : 'Owner verification rejected successfully.',
            owner,
            verification: serializeVerification(owner.verification)
        });

        await logAdminAction({
            adminId: req.user.id,
            adminEmail: req.user.email,
            action: action === 'approve' ? 'Owner Verification Approved' : 'Owner Verification Rejected',
            target: owner.email || owner.username,
            type: 'approval'
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Download owner verification document
exports.downloadOwnerDocument = async (req, res) => {
    try {
        const allowedDocumentTypes = [
            'idDocument',
            'businessCertificate',
            'taxComplianceCertificate',
            'propertyProof'
        ];
        const { ownerId, documentType } = req.params;

        if (!allowedDocumentTypes.includes(documentType)) {
            return res.status(400).json({ message: 'Invalid document type.' });
        }

        const owner = await Owner.findById(ownerId).select('verification');
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

// Reject owner (delete account)
exports.rejectOwner = async (req, res) => {
    try {
        const owner = await Owner.findByIdAndDelete(req.params.ownerId);
        
        if (!owner) {
            return res.status(404).json({ message: 'Owner not found.' });
        }
        
        res.status(200).json({ message: 'Owner rejected and removed.' });

        await logAdminAction({
            adminId: req.user.id,
            adminEmail: req.user.email,
            action: 'Owner Rejected',
            target: owner.email || owner.username,
            type: 'deletion'
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Get all pending hostel approvals
exports.getPendingHostels = async (req, res) => {
    try {
        const pendingHostels = await Hostel.find({ isApproved: false })
            .populate('owner', 'username email');
        
        res.status(200).json({
            total: pendingHostels.length,
            hostels: pendingHostels
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Approve hostel
exports.approveHostel = async (req, res) => {
    try {
        const hostel = await Hostel.findByIdAndUpdate(
            req.params.hostelId,
            { $set: { isApproved: true } },
            { new: true }
        );
        
        if (!hostel) {
            return res.status(404).json({ message: 'Hostel not found.' });
        }
        
        res.status(200).json({
            message: 'Hostel approved successfully.',
            hostel
        });

        await logAdminAction({
            adminId: req.user.id,
            adminEmail: req.user.email,
            action: 'Hostel Approved',
            target: hostel.name,
            type: 'approval'
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Reject hostel
exports.rejectHostel = async (req, res) => {
    try {
        const hostel = await Hostel.findByIdAndDelete(req.params.hostelId);
        
        if (!hostel) {
            return res.status(404).json({ message: 'Hostel not found.' });
        }
        
        // Remove from owner's list
        await Owner.findByIdAndUpdate(hostel.owner, {
            $pull: { hostels: req.params.hostelId }
        });
        
        res.status(200).json({ message: 'Hostel rejected and removed.' });

        await logAdminAction({
            adminId: req.user.id,
            adminEmail: req.user.email,
            action: 'Hostel Rejected',
            target: hostel.name,
            type: 'deletion'
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Revoke hostel approval
exports.unapproveHostel = async (req, res) => {
    try {
        const hostel = await Hostel.findByIdAndUpdate(
            req.params.hostelId,
            { $set: { isApproved: false } },
            { new: true }
        );

        if (!hostel) {
            return res.status(404).json({ message: 'Hostel not found.' });
        }

        res.status(200).json({
            message: 'Hostel approval revoked successfully.',
            hostel
        });

        await logAdminAction({
            adminId: req.user.id,
            adminEmail: req.user.email,
            action: 'Hostel Unapproved',
            target: hostel.name,
            type: 'moderation'
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Get dashboard statistics
exports.getDashboardStats = async (req, res) => {
    try {
        const stats = {
            totalStudents: await Student.countDocuments(),
            totalOwners: await Owner.countDocuments(),
            approvedOwners: await Owner.countDocuments({ isApproved: true }),
            pendingOwners: await Owner.countDocuments({ 'verification.status': 'submitted' }),
            totalHostels: await Hostel.countDocuments(),
            approvedHostels: await Hostel.countDocuments({ isApproved: true }),
            pendingHostels: await Hostel.countDocuments({ isApproved: false })
        };
        
        res.status(200).json(stats);
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Get all users (students)
exports.getAllStudents = async (req, res) => {
    try {
        const students = await Student.find().select('-password');
        res.status(200).json(students);
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Get all owners
exports.getAllOwners = async (req, res) => {
    try {
        const owners = await Owner.find().select('-password').populate('hostels');
        res.status(200).json(owners);
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Delete owner and related records
exports.deleteOwner = async (req, res) => {
    try {
        const owner = await Owner.findById(req.params.ownerId);

        if (!owner) {
            return res.status(404).json({ message: 'Owner not found.' });
        }

        const ownerHostels = await Hostel.find({ owner: owner._id }).select('_id');
        const hostelIds = ownerHostels.map((hostel) => hostel._id);

        await Promise.all([
            Hostel.deleteMany({ owner: owner._id }),
            Booking.deleteMany({ owner: owner._id }),
            PaymentTransaction.deleteMany({ owner: owner._id }),
            Owner.findByIdAndDelete(owner._id)
        ]);

        if (hostelIds.length > 0) {
            await Student.updateMany(
                { favorites: { $in: hostelIds } },
                { $pull: { favorites: { $in: hostelIds } } }
            );
        }

        res.status(200).json({
            message: 'Owner and related records deleted successfully.'
        });

        await logAdminAction({
            adminId: req.user.id,
            adminEmail: req.user.email,
            action: 'Owner Deleted',
            target: owner.email || owner.username,
            type: 'deletion'
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Delete student and related records
exports.deleteStudent = async (req, res) => {
    try {
        const student = await Student.findById(req.params.studentId);

        if (!student) {
            return res.status(404).json({ message: 'Student not found.' });
        }

        await releaseStudentRooms(student._id);

        const ratedHostelIds = await Hostel.find({
            'ratings.student': student._id
        }).distinct('_id');

        await Promise.all([
            Booking.deleteMany({ student: student._id }),
            PaymentTransaction.deleteMany({ student: student._id }),
            Hostel.updateMany(
                { 'ratings.student': student._id },
                { $pull: { ratings: { student: student._id } } }
            ),
            Student.findByIdAndDelete(student._id)
        ]);

        if (ratedHostelIds.length > 0) {
            const hostelsWithUpdatedRatings = await Hostel.find({
                _id: { $in: ratedHostelIds }
            }).select('_id ratings');

            await Promise.all(
                hostelsWithUpdatedRatings.map((hostel) => {
                    const totalRatings = hostel.ratings.reduce((sum, rating) => sum + rating.rating, 0);
                    const averageRating = hostel.ratings.length > 0
                        ? totalRatings / hostel.ratings.length
                        : 0;

                    return Hostel.findByIdAndUpdate(hostel._id, { $set: { averageRating } });
                })
            );
        }

        res.status(200).json({
            message: 'Student and related records deleted successfully.'
        });

        await logAdminAction({
            adminId: req.user.id,
            adminEmail: req.user.email,
            action: 'Student Deleted',
            target: student.email || student.username,
            type: 'deletion'
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Create admin (admin only)
exports.createAdmin = async (req, res) => {
    try {
        const { username, email, password } = req.body;
        
        // Validate input fields
        const validation = validateAdminCreation({ username, email, password });
        if (!validation.isValid) {
            return res.status(400).json({ message: 'Validation failed.', errors: validation.errors });
        }
        
        // Check if email already exists
        const existingAdminEmail = await Admin.findOne({ email });
        if (existingAdminEmail) {
            return res.status(400).json({ message: 'Email already registered.' });
        }
        
        // Check if username already exists
        const existingAdminUsername = await Admin.findOne({ username });
        if (existingAdminUsername) {
            return res.status(400).json({ message: 'Username already taken.' });
        }
        
        const hashedPassword = await hashPassword(password);
        
        const admin = new Admin({
            username,
            email,
            password: hashedPassword
        });
        
        await admin.save();
        
        res.status(201).json({ message: 'Admin created successfully.' });

        await logAdminAction({
            adminId: req.user.id,
            adminEmail: req.user.email,
            action: 'Admin Created',
            target: admin.email,
            type: 'settings'
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};
