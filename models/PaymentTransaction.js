const mongoose = require('mongoose');

const PaymentTransactionSchema = new mongoose.Schema({
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', required: true, index: true },
    provider: { type: String, enum: ['mpesa', 'card'], required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, default: 'KES' },
    status: {
        type: String,
        enum: ['initiated', 'pending', 'succeeded', 'failed', 'cancelled', 'timeout'],
        default: 'initiated',
        index: true
    },
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    providerRequestId: { type: String },
    providerCheckoutId: { type: String },
    providerTransactionId: { type: String, sparse: true, unique: true, index: true },
    providerReference: { type: String },
    webhookEventId: { type: String },
    failureCode: { type: String },
    failureReason: { type: String },
    rawInitResponse: { type: mongoose.Schema.Types.Mixed },
    rawCallback: { type: mongoose.Schema.Types.Mixed }
}, { timestamps: true });

PaymentTransactionSchema.index({ booking: 1, createdAt: -1 });

module.exports = mongoose.model('PaymentTransaction', PaymentTransactionSchema);
