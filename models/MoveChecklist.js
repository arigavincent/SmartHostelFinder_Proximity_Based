const mongoose = require('mongoose');

const ChecklistItemSchema = new mongoose.Schema({
    area: { type: String, required: true, trim: true },
    condition: {
        type: String,
        enum: ['good', 'fair', 'damaged', 'missing'],
        default: 'good'
    },
    notes: { type: String, trim: true },
    photoTaken: { type: Boolean, default: false }
}, { _id: false });

const MoveChecklistSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', required: true, index: true },
    hostel: { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
    tenantName: { type: String, required: true, trim: true },
    roomLabel: { type: String, required: true, trim: true },
    type: {
        type: String,
        enum: ['move_in', 'move_out'],
        required: true
    },
    date: { type: Date, required: true },
    status: {
        type: String,
        enum: ['pending', 'completed', 'disputed'],
        default: 'pending'
    },
    deposit: { type: Number, min: 0, default: 0 },
    deductions: { type: Number, min: 0, default: 0 },
    items: { type: [ChecklistItemSchema], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('MoveChecklist', MoveChecklistSchema);
