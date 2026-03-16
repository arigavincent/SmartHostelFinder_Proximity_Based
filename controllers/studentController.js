const Student = require('../models/Students');
const Hostel = require('../models/Hostel');
const Announcement = require('../models/Announcement');
const AnnouncementRead = require('../models/AnnouncementRead');

const studentAnnouncementFilter = {
    status: 'sent',
    audience: { $in: ['all', 'students'] }
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

// Get student profile
exports.getProfile = async (req, res) => {
    try {
        const student = await Student.findById(req.user.id)
            .select('-password')
            .populate('favorites');
        
        if (!student) {
            return res.status(404).json({ message: 'Student not found.' });
        }
        
        res.status(200).json(student);
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Update student profile
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
        
        const updatedStudent = await Student.findByIdAndUpdate(
            req.user.id,
            { $set: updates },
            { new: true }
        ).select('-password');
        
        res.status(200).json({
            message: 'Profile updated successfully.',
            student: updatedStudent
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Add hostel to favorites
exports.addToFavorites = async (req, res) => {
    try {
        const hostelId = req.params.hostelId;
        
        // Verify hostel exists
        const hostel = await Hostel.findById(hostelId);
        if (!hostel) {
            return res.status(404).json({ message: 'Hostel not found.' });
        }
        
        const student = await Student.findById(req.user.id);
        
        // Check if already in favorites
        if (student.favorites.includes(hostelId)) {
            return res.status(400).json({ message: 'Hostel already in favorites.' });
        }
        
        student.favorites.push(hostelId);
        await student.save();
        
        res.status(200).json({ message: 'Hostel added to favorites.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Remove hostel from favorites
exports.removeFromFavorites = async (req, res) => {
    try {
        const hostelId = req.params.hostelId;
        
        await Student.findByIdAndUpdate(req.user.id, {
            $pull: { favorites: hostelId }
        });
        
        res.status(200).json({ message: 'Hostel removed from favorites.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Get all favorites
exports.getFavorites = async (req, res) => {
    try {
        const student = await Student.findById(req.user.id)
            .populate({
                path: 'favorites',
                populate: { path: 'owner', select: 'username email' }
            });
        
        res.status(200).json(student.favorites);
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Get published announcements for students
exports.getAnnouncements = async (req, res) => {
    try {
        const announcements = await Announcement.find(studentAnnouncementFilter)
            .sort({ publishedAt: -1, createdAt: -1 })
            .limit(10)
            .select('title message audience publishedAt createdAt viewCount');

        const reads = await AnnouncementRead.find({
            userRole: 'student',
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
            ...studentAnnouncementFilter
        });

        if (!announcement) {
            return res.status(404).json({ message: 'Announcement not found.' });
        }

        const existing = await AnnouncementRead.findOne({
            announcement: announcement._id,
            userRole: 'student',
            userId: req.user.id
        });

        if (!existing) {
            await AnnouncementRead.create({
                announcement: announcement._id,
                userRole: 'student',
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
