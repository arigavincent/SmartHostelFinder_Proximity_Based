const mongoose = require('mongoose');

const CaretakerSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', required: true, index: true },
    hostel: { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel' },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true },
    roleTitle: { type: String, required: true, trim: true },
    rating: { type: Number, min: 0, max: 5, default: 5 },
    status: {
        type: String,
        enum: ['active', 'on_leave', 'inactive'],
        default: 'active'
    }
}, { timestamps: true });

module.exports = mongoose.model('Caretaker', CaretakerSchema);
