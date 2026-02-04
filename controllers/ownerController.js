const Owner = require('../models/Owners');
const Hostel = require('../models/Hostel');

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
        res.status(500).json({ message: 'Server error.', error: error.message });
    }
};

// Update owner profile
exports.updateProfile = async (req, res) => {
    try {
        const { username, email } = req.body;
        
        const updatedOwner = await Owner.findByIdAndUpdate(
            req.user.id,
            { $set: { username, email } },
            { new: true }
        ).select('-password');
        
        res.status(200).json({
            message: 'Profile updated successfully.',
            owner: updatedOwner
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.', error: error.message });
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
        res.status(500).json({ message: 'Server error.', error: error.message });
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
        res.status(500).json({ message: 'Server error.', error: error.message });
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
        res.status(500).json({ message: 'Server error.', error: error.message });
    }
};
