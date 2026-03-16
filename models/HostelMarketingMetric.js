const mongoose = require('mongoose');

const HostelMarketingMetricSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', required: true, index: true },
    hostel: { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel', required: true, unique: true, index: true },
    viewsTotal: { type: Number, default: 0, min: 0 },
    sharesTotal: { type: Number, default: 0, min: 0 },
    boostsTotal: { type: Number, default: 0, min: 0 },
    trafficSources: {
        search: { type: Number, default: 0, min: 0 },
        direct: { type: Number, default: 0, min: 0 },
        socialMedia: { type: Number, default: 0, min: 0 },
        referral: { type: Number, default: 0, min: 0 },
        university: { type: Number, default: 0, min: 0 }
    },
    lastBoostedAt: { type: Date },
    lastSharedAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('HostelMarketingMetric', HostelMarketingMetricSchema);
