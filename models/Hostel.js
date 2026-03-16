const mongoose = require('mongoose');
const { getPublicUrl } = require('../services/storageService');

const buildPublicImageUrl = (imagePath) => {
    if (!imagePath || /^https?:\/\//i.test(imagePath)) return imagePath;
    if (String(imagePath).startsWith('uploads/')) {
        const baseUrl = String(process.env.SERVER_URL || 'http://localhost:5100').replace(/\/+$/, '');
        return `${baseUrl}/${String(imagePath).replace(/^\/+/, '')}`;
    }
    return getPublicUrl(imagePath);
};

const HostelSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, required: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', required: true },
    
    // Location with geospatial indexing for proximity search
    location: {
        type: { type: String, enum: ['Point'], default: undefined },
        coordinates: { type: [Number], default: undefined },
        address: { type: String},
        city: { type: String},
        nearbyUniversity: { type: String }
    },
    
    // Pricing
    pricePerMonth: { type: Number, required: true },
    pricePerSemester: { type: Number },
    
    // Hostel type (gender)
    hostelType: { 
        type: String, 
        enum: ['male', 'female', 'mixed'], 
        default: 'mixed' 
    },
    
    // Room details
    roomTypes: [{
        type: { type: String, enum: ['single', 'double', 'bedsitter', '1bedroom', '2bedroom', 'dormitory'] },
        available: { type: Number, default: 0 },
        price: { type: Number }
    }],
    totalRooms: { type: Number, required: true },
    availableRooms: { type: Number, required: true },
    
    // Amenities
    amenities: {
        wifi: { type: Boolean, default: false },
        water: { type: Boolean, default: false },
        electricity: { type: Boolean, default: false },
        security: { type: Boolean, default: false },
        parking: { type: Boolean, default: false },
        laundry: { type: Boolean, default: false },
        kitchen: { type: Boolean, default: false },
        airCondition: { type: Boolean, default: false }
    },
    
    // Images
    images: [{ type: String }],
    
    // Ratings & Reviews
    ratings: [{
        student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
        rating: { type: Number, min: 1, max: 5 },
        review: { type: String },
        createdAt: { type: Date, default: Date.now }
    }],
    averageRating: { type: Number, default: 0 },
    
    // Status
    isApproved: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    
    // Contact
    contactPhone: { type: String, required: true },
    contactEmail: { type: String }
    
}, { timestamps: true });

// Only index hostels that actually have valid GeoJSON coordinates.
HostelSchema.index(
    { location: '2dsphere' },
    {
        partialFilterExpression: {
            'location.type': 'Point'
        }
    }
);
HostelSchema.pre('validate', function normalizeLocation() {
    if (!this.location) {
        return;
    }

    const hasCoordinates = Array.isArray(this.location.coordinates)
        && this.location.coordinates.length === 2
        && this.location.coordinates.every((value) => Number.isFinite(Number(value)));

    if (hasCoordinates) {
        this.location.type = 'Point';
        this.location.coordinates = this.location.coordinates.map((value) => Number(value));
    } else {
        this.location.type = undefined;
        this.location.coordinates = undefined;
    }
});
HostelSchema.set('toJSON', {
    transform: (doc, ret) => {
        if (Array.isArray(ret.images)) {
            ret.images = ret.images.map((image) => buildPublicImageUrl(image));
        }
        return ret;
    }
});

module.exports = mongoose.model('Hostel', HostelSchema);
