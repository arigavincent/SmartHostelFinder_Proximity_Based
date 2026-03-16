const mongoose = require('mongoose');

const LeaseSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', required: true, index: true },
    hostel: { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    tenantName: { type: String, required: true, trim: true },
    tenantEmail: { type: String, trim: true },
    roomLabel: { type: String, trim: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    monthlyRent: { type: Number, required: true, min: 0 },
    archivedAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('Lease', LeaseSchema);
