const Admin = require('../models/Admin');
const Owner = require('../models/Owners');
const Student = require('../models/Students');
const Hostel = require('../models/Hostel');
const { hashPassword } = require('../helpers/passwordHelper');
const { validateAdminCreation } = require('../helpers/validationHelper');
const { sendApprovalEmail, sendSuspensionEmail } = require('../helpers/emailHelper');

// Get all pending owner approvals
exports.getPendingOwners = async (req, res) => {
    try {
        const pendingOwners = await Owner.find({ isApproved: false })
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
        const owner = await Owner.findByIdAndUpdate(
            req.params.ownerId,
            { $set: { isApproved: true } },
            { new: true }
        ).select('-password');
        
        if (!owner) {
            return res.status(404).json({ message: 'Owner not found.' });
        }

        // Notify owner via email (non-blocking)
        sendApprovalEmail(owner.email, owner.username, true).catch(err =>
            console.error('Approval email failed:', err.message)
        );
        
        res.status(200).json({
            message: 'Owner approved successfully.',
            owner
        });
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

        // Notify owner via email (non-blocking)
        sendApprovalEmail(owner.email, owner.username, false).catch(err =>
            console.error('Rejection email failed:', err.message)
        );
        
        res.status(200).json({ message: 'Owner rejected and removed.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Suspend owner (revoke approval without deleting)
exports.suspendOwner = async (req, res) => {
    try {
        const owner = await Owner.findByIdAndUpdate(
            req.params.ownerId,
            { $set: { isApproved: false } },
            { new: true }
        ).select('-password');

        if (!owner) {
            return res.status(404).json({ message: 'Owner not found.' });
        }

        // Notify owner via email (non-blocking)
        sendSuspensionEmail(owner.email, owner.username).catch(err =>
            console.error('Suspension email failed:', err.message)
        );

        res.status(200).json({
            message: 'Owner suspended successfully.',
            owner
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
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Un-approve hostel (revoke approval without deleting)
exports.unapproveHostel = async (req, res) => {
    try {
        const hostel = await Hostel.findByIdAndUpdate(
            req.params.hostelId,
            { $set: { isApproved: false } },
            { new: true }
        ).populate('owner', 'username email');

        if (!hostel) {
            return res.status(404).json({ message: 'Hostel not found.' });
        }

        res.status(200).json({
            message: 'Hostel approval revoked. It is now pending review.',
            hostel
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
            pendingOwners: await Owner.countDocuments({ isApproved: false }),
            totalHostels: await Hostel.countDocuments(),
            approvedHostels: await Hostel.countDocuments({ isApproved: true }),
            pendingHostels: await Hostel.countDocuments({ isApproved: false })
        };
        
        res.status(200).json(stats);
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Delete a student account
exports.deleteStudent = async (req, res) => {
    try {
        const student = await Student.findByIdAndDelete(req.params.studentId);
        if (!student) {
            return res.status(404).json({ message: 'Student not found.' });
        }
        res.status(200).json({ message: 'Student account deleted successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Delete an owner account (+ all their hostels)
exports.deleteOwner = async (req, res) => {
    try {
        const owner = await Owner.findById(req.params.ownerId);
        if (!owner) {
            return res.status(404).json({ message: 'Owner not found.' });
        }

        // Delete all hostels belonging to this owner
        await Hostel.deleteMany({ owner: owner._id });

        await Owner.findByIdAndDelete(owner._id);

        res.status(200).json({ message: 'Owner and all associated hostels deleted successfully.' });
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
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};
