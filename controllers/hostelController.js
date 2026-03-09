const Hostel = require('../models/Hostel');
const Owner = require('../models/Owners');
const Booking = require('../models/Booking');
const cloudinary = require('../config/cloudinary');

// ── Cloudinary helpers ───────────────────────────────────────────────────────
const uploadToCloudinary = (buffer, folder = 'hostels') =>
    new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder, resource_type: 'image' },
            (err, result) => (err ? reject(err) : resolve(result.secure_url))
        );
        stream.end(buffer);
    });

const deleteFromCloudinary = async (url) => {
    try {
        // Extract public_id: everything after /upload/[vXXXX/]{folder}/{name}.ext
        const parts = url.split('/');
        const uploadIdx = parts.indexOf('upload');
        if (uploadIdx === -1) return;
        // Skip optional version segment (e.g. v1234567)
        const afterUpload = parts.slice(uploadIdx + 1);
        const startIdx = /^v\d+$/.test(afterUpload[0]) ? 1 : 0;
        const publicIdWithExt = afterUpload.slice(startIdx).join('/');
        const publicId = publicIdWithExt.replace(/\.[^/.]+$/, '');
        await cloudinary.uploader.destroy(publicId);
    } catch { /* best-effort – don't fail the request */ }
};

const OWNER_ALLOWED_HOSTEL_UPDATES = new Set([
    'name',
    'description',
    'location',
    'pricePerMonth',
    'pricePerSemester',
    'hostelType',
    'roomTypes',
    'totalRooms',
    'availableRooms',
    'amenities',
    'images',
    'contactPhone',
    'contactEmail',
    'isActive'
]);

const ADMIN_ALLOWED_HOSTEL_UPDATES = new Set([
    ...OWNER_ALLOWED_HOSTEL_UPDATES,
    'isApproved'
]);

const pickAllowedHostelUpdates = (payload, isAdmin) => {
    const allowed = isAdmin ? ADMIN_ALLOWED_HOSTEL_UPDATES : OWNER_ALLOWED_HOSTEL_UPDATES;
    const updates = {};

    for (const [key, value] of Object.entries(payload)) {
        if (allowed.has(key) && value !== undefined) {
            updates[key] = value;
        }
    }

    return updates;
};

// Create a new hostel (Owner only)
exports.createHostel = async (req, res) => {
    try {
        const body = { ...req.body };

        // Parse JSON-stringified nested fields from FormData
        if (typeof body.location === 'string') {
            try { body.location = JSON.parse(body.location); } catch { body.location = {}; }
        }
        if (typeof body.amenities === 'string') {
            try { body.amenities = JSON.parse(body.amenities); } catch { body.amenities = {}; }
        }

        // Upload images to Cloudinary
        const imageUrls = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const url = await uploadToCloudinary(file.buffer, 'hostels');
                imageUrls.push(url);
            }
        }

        const hostelData = {
            ...body,
            owner: req.user.id,
            images: imageUrls
        };

        const hostel = new Hostel(hostelData);
        const savedHostel = await hostel.save();

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

// Upload images to existing hostel (Owner only)
exports.uploadHostelImages = async (req, res) => {
    try {
        const hostel = await Hostel.findById(req.params.id);
        if (!hostel) return res.status(404).json({ message: 'Hostel not found.' });
        if (hostel.owner.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized.' });
        }
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: 'No images provided.' });
        }

        const imageUrls = [];
        for (const file of req.files) {
            const url = await uploadToCloudinary(file.buffer, 'hostels');
            imageUrls.push(url);
        }

        hostel.images.push(...imageUrls);
        await hostel.save();

        res.status(200).json({ message: 'Images uploaded.', images: hostel.images });
    } catch (error) {
        res.status(500).json({ message: 'Server error.', error: error.message });
    }
};

// Delete a single image from hostel (Owner/Admin)
exports.deleteHostelImage = async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) return res.status(400).json({ message: 'Image URL required as query param ?url=...' });

        const hostel = await Hostel.findById(req.params.id);
        if (!hostel) return res.status(404).json({ message: 'Hostel not found.' });
        if (hostel.owner.toString() !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Not authorized.' });
        }

        hostel.images = hostel.images.filter(img => img !== url);
        await hostel.save();

        // Remove from Cloudinary (best-effort)
        await deleteFromCloudinary(url);

        res.status(200).json({ message: 'Image deleted.', images: hostel.images });
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
        res.status(500).json({ message: 'Server error.' });
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
        res.status(500).json({ message: 'Server error.' });
    }
};

// Get single hostel by ID
exports.getHostelById = async (req, res) => {
    try {
        const hostel = await Hostel.findOne({
            _id: req.params.id,
            isApproved: true,
            isActive: true
        })
            .populate('owner', 'username email')
            .populate('ratings.student', 'username');
        
        if (!hostel) {
            return res.status(404).json({ message: 'Hostel not found.' });
        }
        
        res.status(200).json(hostel);
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
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

        const isAdmin = req.user.role === 'admin';
        const updates = pickAllowedHostelUpdates(req.body, isAdmin);

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ message: 'No valid fields provided for update.' });
        }

        if (updates.totalRooms !== undefined) {
            const totalRooms = Number(updates.totalRooms);
            if (!Number.isFinite(totalRooms) || totalRooms < 0) {
                return res.status(400).json({ message: 'Total rooms must be a non-negative number.' });
            }
            updates.totalRooms = totalRooms;
        }

        if (updates.availableRooms !== undefined) {
            const availableRooms = Number(updates.availableRooms);
            if (!Number.isFinite(availableRooms) || availableRooms < 0) {
                return res.status(400).json({ message: 'Available rooms must be a non-negative number.' });
            }
            updates.availableRooms = availableRooms;
        }

        if (updates.pricePerMonth !== undefined) {
            const pricePerMonth = Number(updates.pricePerMonth);
            if (!Number.isFinite(pricePerMonth) || pricePerMonth <= 0) {
                return res.status(400).json({ message: 'Monthly price must be greater than zero.' });
            }
            updates.pricePerMonth = pricePerMonth;
        }

        if (updates.pricePerSemester !== undefined) {
            const pricePerSemester = Number(updates.pricePerSemester);
            if (!Number.isFinite(pricePerSemester) || pricePerSemester <= 0) {
                return res.status(400).json({ message: 'Semester price must be greater than zero.' });
            }
            updates.pricePerSemester = pricePerSemester;
        }

        const nextTotalRooms = updates.totalRooms !== undefined ? updates.totalRooms : hostel.totalRooms;
        const nextAvailableRooms = updates.availableRooms !== undefined ? updates.availableRooms : hostel.availableRooms;

        if (nextAvailableRooms > nextTotalRooms) {
            return res.status(400).json({ message: 'Available rooms cannot exceed total rooms.' });
        }
        
        const updatedHostel = await Hostel.findByIdAndUpdate(
            req.params.id,
            { $set: updates },
            { new: true, runValidators: true }
        );
        
        res.status(200).json({
            message: 'Hostel updated successfully.',
            hostel: updatedHostel
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
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
        res.status(500).json({ message: 'Server error.' });
    }
};

// Add rating/review (Student only)
exports.addRating = async (req, res) => {
    try {
        const { rating, review } = req.body;
        const hostelId = req.params.id;

        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({ message: 'Rating must be between 1 and 5.' });
        }

        // Verify student has a confirmed booking for this hostel
        const confirmedBooking = await Booking.findOne({
            student: req.user.id,
            hostel: hostelId,
            status: 'confirmed',
        });
        if (!confirmedBooking) {
            return res.status(403).json({
                message: 'You can only rate a hostel after a confirmed booking.',
            });
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
        res.status(500).json({ message: 'Server error.' });
    }
};
