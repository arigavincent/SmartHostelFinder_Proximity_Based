const Hostel = require('../models/Hostel');
const Owner = require('../models/Owners');
const cloudinary = require('../config/cloudinary');
const { logger } = require('../helpers/logger');
const {
    deleteObject,
    extractStorageKey,
    generateObjectKey,
    saveBuffer
} = require('../services/storageService');

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
        const parts = String(url || '').split('/');
        const uploadIdx = parts.indexOf('upload');
        if (uploadIdx === -1) return;
        const afterUpload = parts.slice(uploadIdx + 1);
        const startIdx = /^v\d+$/.test(afterUpload[0]) ? 1 : 0;
        const publicIdWithExt = afterUpload.slice(startIdx).join('/');
        const publicId = publicIdWithExt.replace(/\.[^/.]+$/, '');
        if (!publicId) return;
        await cloudinary.uploader.destroy(publicId);
    } catch (_error) {
        return null;
    }
};

const isCloudinaryConfigured = () => (
    Boolean(process.env.CLOUDINARY_CLOUD_NAME)
    && Boolean(process.env.CLOUDINARY_API_KEY)
    && Boolean(process.env.CLOUDINARY_API_SECRET || process.env.CLOUDINARY_SECRET_KEY)
);

const saveHostelImage = async (ownerId, file) => {
    if (!file?.buffer) return null;

    if (isCloudinaryConfigured()) {
        return uploadToCloudinary(file.buffer, 'hostels');
    }

    const key = generateObjectKey(`public/images/${ownerId}`, file.originalname);
    await saveBuffer({
        key,
        buffer: file.buffer,
        contentType: file.mimetype
    });
    return key;
};

const deleteHostelImageObject = async (storedImage) => {
    if (!storedImage) return;

    if (String(storedImage).includes('/upload/')) {
        await deleteFromCloudinary(storedImage);
        return;
    }

    const normalizedPath = extractStorageKey(storedImage);
    if (normalizedPath) {
        await deleteObject(normalizedPath).catch(() => null);
    }
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

const parseJsonField = (value) => {
    if (value === undefined || value === null) return value;
    if (typeof value !== 'string') return value;

    try {
        return JSON.parse(value);
    } catch (error) {
        return value;
    }
};

const normalizeHostelPayload = (payload = {}) => {
    const body = { ...payload };
    body.location = parseJsonField(body.location);
    body.amenities = parseJsonField(body.amenities);

    if (body.location && Array.isArray(body.location.coordinates)) {
        body.location.type = 'Point';
        body.location.coordinates = body.location.coordinates.map((coordinate) => parseFloat(coordinate));
    }

    if (body.amenities && typeof body.amenities === 'object') {
        Object.keys(body.amenities).forEach((key) => {
            if (typeof body.amenities[key] === 'string') {
                body.amenities[key] = body.amenities[key] === 'true';
            }
        });
    }

    return body;
};

const canManageHostel = (hostel, user) => {
    if (!user) return false;
    return user.role === 'admin' || hostel.owner.toString() === user.id;
};

const getClientFacingError = (error) => {
    if (!error) {
        return { statusCode: 500, message: 'Server error.' };
    }

    if (error.statusCode && error.statusCode < 500) {
        return { statusCode: error.statusCode, message: error.message };
    }

    if (error.name === 'ValidationError') {
        const firstMessage = Object.values(error.errors || {})[0]?.message;
        return {
            statusCode: 400,
            message: firstMessage || 'Invalid hostel data.'
        };
    }

    if (error.code === 11000) {
        return {
            statusCode: 409,
            message: 'A hostel with the same unique data already exists.'
        };
    }

    if (error.name === 'MongoServerError' || error.name === 'MongoError') {
        return {
            statusCode: 400,
            message: error.message || 'Database rejected the hostel data.'
        };
    }

    return {
        statusCode: 500,
        message: error.message || 'Server error.'
    };
};

// Create a new hostel (Owner only)
exports.createHostel = async (req, res) => {
    try {
        const body = normalizeHostelPayload(req.body);
        const uploadedImages = req.files || [];
        const images = [];
        for (const file of uploadedImages) {
            const storedImage = await saveHostelImage(req.user.id, file);
            if (storedImage) images.push(storedImage);
        }

        const hostelData = {
            ...body,
            owner: req.user.id,
            images
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
        const clientError = getClientFacingError(error);
        logger.error('hostel.create_failed', {
            ownerId: req.user?.id,
            error: error.message,
            stack: error.stack
        });
        res.status(clientError.statusCode).json({ message: clientError.message });
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
        const clientError = getClientFacingError(error);
        logger.error('hostel.update_failed', {
            hostelId: req.params.id,
            actorId: req.user?.id,
            error: error.message,
            stack: error.stack
        });
        res.status(clientError.statusCode).json({ message: clientError.message });
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
        const clientError = getClientFacingError(error);
        logger.error('hostel.upload_images_failed', {
            hostelId: req.params.id,
            actorId: req.user?.id,
            error: error.message,
            stack: error.stack
        });
        res.status(clientError.statusCode).json({ message: clientError.message });
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

        const isManager = canManageHostel(hostel, req.user);
        const isPubliclyVisible = hostel.isApproved && hostel.isActive;

        if (!isPubliclyVisible && !isManager) {
            return res.status(404).json({ message: 'Hostel not found.' });
        }
        
        res.status(200).json(hostel);
    } catch (error) {
        const clientError = getClientFacingError(error);
        logger.error('hostel.delete_image_failed', {
            hostelId: req.params.id,
            actorId: req.user?.id,
            error: error.message,
            stack: error.stack
        });
        res.status(clientError.statusCode).json({ message: clientError.message });
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
        const normalizedPayload = normalizeHostelPayload(req.body);
        const updates = pickAllowedHostelUpdates(normalizedPayload, isAdmin);

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

// Upload hostel images (Owner/Admin)
exports.uploadHostelImages = async (req, res) => {
    try {
        const hostel = await Hostel.findById(req.params.id);

        if (!hostel) {
            return res.status(404).json({ message: 'Hostel not found.' });
        }

        if (!canManageHostel(hostel, req.user)) {
            return res.status(403).json({ message: 'Not authorized to update this hostel.' });
        }

        const newImages = [];
        for (const file of req.files || []) {
            const storedImage = await saveHostelImage(hostel.owner, file);
            if (storedImage) newImages.push(storedImage);
        }
        hostel.images = [...hostel.images, ...newImages].slice(0, 10);
        await hostel.save();
        const serializedHostel = hostel.toJSON();

        res.status(200).json({
            message: 'Images uploaded successfully.',
            images: serializedHostel.images
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

// Delete specific hostel image (Owner/Admin)
exports.deleteHostelImage = async (req, res) => {
    try {
        const imageUrl = String(req.query.url || '').trim();
        if (!imageUrl) {
            return res.status(400).json({ message: 'Image url is required.' });
        }

        const hostel = await Hostel.findById(req.params.id);

        if (!hostel) {
            return res.status(404).json({ message: 'Hostel not found.' });
        }

        if (!canManageHostel(hostel, req.user)) {
            return res.status(403).json({ message: 'Not authorized to update this hostel.' });
        }

        const existingImage = hostel.images.find((image) => image === imageUrl);
        if (!existingImage) {
            return res.status(404).json({ message: 'Image not found on this hostel.' });
        }

        hostel.images = hostel.images.filter((image) => image !== existingImage);
        await hostel.save();
        await deleteHostelImageObject(existingImage);
        const serializedHostel = hostel.toJSON();

        res.status(200).json({
            message: 'Image deleted successfully.',
            images: serializedHostel.images
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

        await Promise.all((hostel.images || []).map((imageUrl) => deleteHostelImageObject(imageUrl)));
        
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
        res.status(500).json({ message: 'Server error.' });
    }
};
