const Student = require('../models/Students');
const Hostel = require('../models/Hostel');

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
        res.status(500).json({ message: 'Server error.', error: error.message });
    }
};

// Update student profile
exports.updateProfile = async (req, res) => {
    try {
        const { username, email } = req.body;
        
        const updatedStudent = await Student.findByIdAndUpdate(
            req.user.id,
            { $set: { username, email } },
            { new: true }
        ).select('-password');
        
        res.status(200).json({
            message: 'Profile updated successfully.',
            student: updatedStudent
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.', error: error.message });
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
        res.status(500).json({ message: 'Server error.', error: error.message });
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
        res.status(500).json({ message: 'Server error.', error: error.message });
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
        res.status(500).json({ message: 'Server error.', error: error.message });
    }
};
