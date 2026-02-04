const Hostel = require('../models/Hostel');
const Owner = require('../models/Owners');

// Create a new hostel (Owner only)
exports.createHostel = async (req, res) => {
    try {
        const hostelData = {
            ...req.body,
            owner: req.user.id,
            images: req.files ? req.files.map(file => file.path) : []
        };
        
        const hostel = new Hostel(hostelData);
        const savedHostel = await hostel.save();
        
        // Add hostel to owner's hostel list
        await Owner.findByIdAndUpdate(req.user.id, {
            $push: { hostels: savedHostel._id }
        });
        
        res.status(201).json({
            message: 'Hostel created. Pending admin approval.',
            hostel: savedHostel
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.', error: error.message });
    }
};

// Get all approved hostels (Public)
exports.getAllHostels = async (req, res) => {
    try {
        const { page = 1, limit = 10, city, minPrice, maxPrice } = req.query;
        
        const query = { isApproved: true, isActive: true };
        
        if (city) query['location.city'] = new RegExp(city, 'i');
        if (minPrice || maxPrice) {
            query.pricePerMonth = {};
            if (minPrice) query.pricePerMonth.$gte = Number(minPrice);
            if (maxPrice) query.pricePerMonth.$lte = Number(maxPrice);
        }
        
        const hostels = await Hostel.find(query)
            .populate('owner', 'username email')
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .sort({ createdAt: -1 });
        
        const total = await Hostel.countDocuments(query);
        
        res.status(200).json({
            hostels,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            total
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.', error: error.message });
    }
};

// Search hostels by proximity (within radius of coordinates)
exports.searchByProximity = async (req, res) => {
    try {
        const { longitude, latitude, radiusKm = 5, page = 1, limit = 10 } = req.query;
        
        if (!longitude || !latitude) {
            return res.status(400).json({ message: 'Longitude and latitude are required.' });
        }
        
        const hostels = await Hostel.find({
            isApproved: true,
            isActive: true,
            location: {
                $nearSphere: {
                    $geometry: {
                        type: 'Point',
                        coordinates: [parseFloat(longitude), parseFloat(latitude)]
                    },
                    $maxDistance: radiusKm * 1000 // Convert km to meters
                }
            }
        })
        .populate('owner', 'username email')
        .limit(limit * 1)
        .skip((page - 1) * limit);
        
        res.status(200).json({
            message: `Found ${hostels.length} hostels within ${radiusKm}km radius.`,
            hostels
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.', error: error.message });
    }
};

// Get single hostel by ID
exports.getHostelById = async (req, res) => {
    try {
        const hostel = await Hostel.findById(req.params.id)
            .populate('owner', 'username email')
            .populate('ratings.student', 'username');
        
        if (!hostel) {
            return res.status(404).json({ message: 'Hostel not found.' });
        }
        
        res.status(200).json(hostel);
    } catch (error) {
        res.status(500).json({ message: 'Server error.', error: error.message });
    }
};

// Update hostel (Owner only)
exports.updateHostel = async (req, res) => {
    try {
        const hostel = await Hostel.findById(req.params.id);
        
        if (!hostel) {
            return res.status(404).json({ message: 'Hostel not found.' });
        }
        
        // Verify ownership
        if (hostel.owner.toString() !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Not authorized to update this hostel.' });
        }
        
        const updatedHostel = await Hostel.findByIdAndUpdate(
            req.params.id,
            { $set: req.body },
            { new: true }
        );
        
        res.status(200).json({
            message: 'Hostel updated successfully.',
            hostel: updatedHostel
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.', error: error.message });
    }
};

// Delete hostel (Owner/Admin)
exports.deleteHostel = async (req, res) => {
    try {
        const hostel = await Hostel.findById(req.params.id);
        
        if (!hostel) {
            return res.status(404).json({ message: 'Hostel not found.' });
        }
        
        // Verify ownership or admin
        if (hostel.owner.toString() !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Not authorized to delete this hostel.' });
        }
        
        await Hostel.findByIdAndDelete(req.params.id);
        
        // Remove from owner's hostel list
        await Owner.findByIdAndUpdate(hostel.owner, {
            $pull: { hostels: req.params.id }
        });
        
        res.status(200).json({ message: 'Hostel deleted successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error.', error: error.message });
    }
};

// Add rating/review (Student only)
exports.addRating = async (req, res) => {
    try {
        const { rating, review } = req.body;
        const hostelId = req.params.id;
        
        if (rating < 1 || rating > 5) {
            return res.status(400).json({ message: 'Rating must be between 1 and 5.' });
        }
        
        const hostel = await Hostel.findById(hostelId);
        
        if (!hostel) {
            return res.status(404).json({ message: 'Hostel not found.' });
        }
        
        // Check if student already rated
        const existingRating = hostel.ratings.find(
            r => r.student.toString() === req.user.id
        );
        
        if (existingRating) {
            return res.status(400).json({ message: 'You have already rated this hostel.' });
        }
        
        // Add rating
        hostel.ratings.push({
            student: req.user.id,
            rating,
            review
        });
        
        // Calculate average rating
        const totalRatings = hostel.ratings.reduce((sum, r) => sum + r.rating, 0);
        hostel.averageRating = totalRatings / hostel.ratings.length;
        
        await hostel.save();
        
        res.status(201).json({
            message: 'Rating added successfully.',
            averageRating: hostel.averageRating
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.', error: error.message });
    }
};
