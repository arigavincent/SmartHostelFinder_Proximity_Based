const mongoose = require('mongoose');

const HostelSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, required: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', required: true },
    
    // Location with geospatial indexing for proximity search
    location: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number]},
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

// Geospatial index for proximity queries
HostelSchema.index({ 'location': '2dsphere' });

module.exports = mongoose.model('Hostel', HostelSchema);
