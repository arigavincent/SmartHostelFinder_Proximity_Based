const mongoose = require('mongoose');

const CommissionTierSchema = new mongoose.Schema({
    rangeLabel: { type: String, required: true, trim: true },
    minHostels: { type: Number, required: true, min: 0 },
    maxHostels: { type: Number, default: null },
    rate: { type: Number, required: true, min: 0 }
}, { _id: false });

const CommissionConfigSchema = new mongoose.Schema({
    defaultRate: { type: Number, required: true, min: 0, default: 10 },
    tiers: {
        type: [CommissionTierSchema],
        default: () => ([
            { rangeLabel: '1-5 hostels', minHostels: 1, maxHostels: 5, rate: 10 },
            { rangeLabel: '6-15 hostels', minHostels: 6, maxHostels: 15, rate: 8 },
            { rangeLabel: '16+ hostels', minHostels: 16, maxHostels: null, rate: 6 }
        ])
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }
}, { timestamps: true });

module.exports = mongoose.model('CommissionConfig', CommissionConfigSchema);
