const crypto = require('crypto');
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const PaymentTransaction = require('../models/PaymentTransaction');
const { initializePaymentWithProvider, normalizeProvider, parseProviderWebhook } = require('../helpers/paymentProvider');
const { verifyWebhookSignature } = require('../helpers/paymentWebhookVerifier');

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'timeout']);

const generateReceiptNumber = () => {
    return `RCP-${Date.now()}-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
};

const getIdempotencyKey = (req) => {
    const headerKey = req.get('Idempotency-Key');
    const bodyKey = req.body?.idempotencyKey;
    const key = headerKey || bodyKey;
    if (!key) return crypto.randomUUID();
    return String(key).trim();
};

const canAccessBookingPayment = (booking, user) => {
    const bookingStudent = booking.student?.toString() || booking.student?._id?.toString();
    const bookingOwner = booking.owner?.toString() || booking.owner?._id?.toString();
    const isStudent = bookingStudent === user.id;
    const isOwner = bookingOwner === user.id;
    const isAdmin = user.role === 'admin';
    return isStudent || isOwner || isAdmin;
};

const findTransactionFromWebhook = async (provider, parsedWebhook) => {
    const conditions = [];

    if (parsedWebhook.providerTransactionId) {
        conditions.push({ providerTransactionId: parsedWebhook.providerTransactionId });
    }
    if (parsedWebhook.providerRequestId) {
        conditions.push({ providerRequestId: parsedWebhook.providerRequestId });
    }
    if (parsedWebhook.providerCheckoutId) {
        conditions.push({ providerCheckoutId: parsedWebhook.providerCheckoutId });
    }
    if (parsedWebhook.idempotencyKey) {
        conditions.push({ idempotencyKey: parsedWebhook.idempotencyKey });
    }

    if (conditions.length === 0) return null;

    return PaymentTransaction.findOne({
        provider,
        $or: conditions
    });
};

exports.initializePayment = async (req, res) => {
    try {
        const { bookingId, provider, payer } = req.body;

        if (!bookingId || !mongoose.Types.ObjectId.isValid(bookingId)) {
            return res.status(400).json({ message: 'Valid bookingId is required.' });
        }

        const booking = await Booking.findById(bookingId);
        if (!booking) {
            return res.status(404).json({ message: 'Booking not found.' });
        }

        if (booking.student.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized to initialize payment for this booking.' });
        }

        if (booking.status === 'cancelled') {
            return res.status(400).json({ message: 'Cannot initialize payment for cancelled booking.' });
        }

        if (booking.status === 'confirmed' || booking.payment?.status === 'paid') {
            return res.status(400).json({ message: 'Booking is already paid and confirmed.' });
        }

        const selectedProvider = normalizeProvider(provider || booking.payment?.method);
        if (!selectedProvider) {
            return res.status(400).json({ message: 'Payment provider must be mpesa or card.' });
        }

        const amount = Number(booking.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ message: 'Booking amount is invalid.' });
        }

        const idempotencyKey = getIdempotencyKey(req);
        if (!idempotencyKey || idempotencyKey.length > 128) {
            return res.status(400).json({ message: 'Invalid idempotency key.' });
        }

        const existingTransaction = await PaymentTransaction.findOne({ idempotencyKey });
        if (existingTransaction) {
            if (existingTransaction.student.toString() !== req.user.id) {
                return res.status(409).json({ message: 'Idempotency key already used by another payment.' });
            }

            return res.status(200).json({
                message: 'Payment already initialized for this idempotency key.',
                idempotent: true,
                transaction: existingTransaction
            });
        }

        let transaction;
        try {
            transaction = await PaymentTransaction.create({
                booking: booking._id,
                student: booking.student,
                owner: booking.owner,
                provider: selectedProvider,
                amount,
                currency: booking.currency || 'KES',
                status: 'initiated',
                idempotencyKey
            });
        } catch (error) {
            if (error.code === 11000) {
                const duplicate = await PaymentTransaction.findOne({ idempotencyKey });
                if (duplicate) {
                    return res.status(200).json({
                        message: 'Payment already initialized for this idempotency key.',
                        idempotent: true,
                        transaction: duplicate
                    });
                }
            }
            throw error;
        }

        try {
            const providerInit = await initializePaymentWithProvider({
                provider: selectedProvider,
                amount,
                currency: booking.currency || 'KES',
                bookingId: String(booking._id),
                idempotencyKey,
                payer
            });

            transaction.status = providerInit.status || 'pending';
            transaction.providerRequestId = providerInit.providerRequestId || transaction.providerRequestId;
            transaction.providerCheckoutId = providerInit.providerCheckoutId || transaction.providerCheckoutId;
            transaction.providerReference = providerInit.providerReference || transaction.providerReference;
            transaction.rawInitResponse = providerInit.rawResponse || providerInit;
            await transaction.save();

            return res.status(201).json({
                message: 'Payment initialization started.',
                transaction
            });
        } catch (providerError) {
            transaction.status = 'failed';
            transaction.failureReason = 'Provider initialization failed.';
            transaction.rawInitResponse = { error: providerError.message };
            await transaction.save();

            return res.status(502).json({
                message: 'Failed to initialize payment with provider.'
            });
        }
    } catch (error) {
        return res.status(500).json({ message: 'Server error.' });
    }
};

exports.getBookingPaymentStatus = async (req, res) => {
    try {
        const { bookingId } = req.params;

        if (!bookingId || !mongoose.Types.ObjectId.isValid(bookingId)) {
            return res.status(400).json({ message: 'Valid bookingId is required.' });
        }

        const booking = await Booking.findById(bookingId);
        if (!booking) {
            return res.status(404).json({ message: 'Booking not found.' });
        }

        if (!canAccessBookingPayment(booking, req.user)) {
            return res.status(403).json({ message: 'Not authorized to view this payment status.' });
        }

        const transactions = await PaymentTransaction.find({ booking: booking._id })
            .sort({ createdAt: -1 })
            .limit(20);

        return res.status(200).json({
            booking: {
                id: booking._id,
                status: booking.status,
                amount: booking.amount,
                currency: booking.currency,
                payment: booking.payment
            },
            latestTransaction: transactions[0] || null,
            transactions
        });
    } catch (error) {
        return res.status(500).json({ message: 'Server error.' });
    }
};

exports.handleWebhook = async (req, res) => {
    try {
        const provider = normalizeProvider(req.params.provider);
        if (!provider) {
            return res.status(400).json({ message: 'Unsupported payment provider.' });
        }

        const secret = process.env.PAYMENT_WEBHOOK_SECRET;
        const isValidSignature = verifyWebhookSignature({
            headers: req.headers,
            payload: req.body,
            secret
        });

        if (!isValidSignature) {
            return res.status(401).json({ message: 'Invalid webhook signature.' });
        }

        let parsedWebhook;
        try {
            parsedWebhook = parseProviderWebhook(provider, req.body);
        } catch (parseError) {
            return res.status(400).json({ message: 'Invalid webhook payload.' });
        }

        const transaction = await findTransactionFromWebhook(provider, parsedWebhook);
        if (!transaction) {
            return res.status(404).json({ message: 'Payment transaction not found.' });
        }

        if (
            parsedWebhook.eventId
            && transaction.webhookEventId === parsedWebhook.eventId
            && TERMINAL_STATUSES.has(transaction.status)
        ) {
            return res.status(200).json({ message: 'Webhook already processed.' });
        }

        if (TERMINAL_STATUSES.has(transaction.status)) {
            return res.status(200).json({ message: 'Transaction already finalized.' });
        }

        const transactionUpdate = {
            status: parsedWebhook.status,
            providerTransactionId: parsedWebhook.providerTransactionId || transaction.providerTransactionId,
            providerRequestId: parsedWebhook.providerRequestId || transaction.providerRequestId,
            providerCheckoutId: parsedWebhook.providerCheckoutId || transaction.providerCheckoutId,
            providerReference: parsedWebhook.providerReference || transaction.providerReference,
            failureCode: parsedWebhook.failureCode || transaction.failureCode,
            failureReason: parsedWebhook.failureReason || transaction.failureReason,
            rawCallback: parsedWebhook.rawPayload
        };

        if (parsedWebhook.eventId) {
            transactionUpdate.webhookEventId = parsedWebhook.eventId;
        }

        const updatedTransaction = await PaymentTransaction.findOneAndUpdate(
            {
                _id: transaction._id,
                status: { $nin: Array.from(TERMINAL_STATUSES) }
            },
            { $set: transactionUpdate },
            { new: true }
        );

        if (!updatedTransaction) {
            return res.status(200).json({ message: 'Webhook already processed.' });
        }

        const booking = await Booking.findById(updatedTransaction.booking);
        if (!booking) {
            return res.status(404).json({ message: 'Booking not found for payment transaction.' });
        }

        if (updatedTransaction.status === 'succeeded') {
            if (booking.status !== 'cancelled') {
                booking.payment.status = 'paid';
                booking.payment.reference =
                    updatedTransaction.providerReference
                    || updatedTransaction.providerTransactionId
                    || updatedTransaction.providerRequestId
                    || booking.payment.reference;
                booking.payment.paidAt = new Date();
                booking.status = 'confirmed';
                if (!booking.receipt?.receiptNumber) {
                    booking.receipt = {
                        receiptNumber: generateReceiptNumber(),
                        issuedAt: new Date()
                    };
                }
                await booking.save();
            }

            return res.status(200).json({ message: 'Payment marked as succeeded.' });
        }

        if (updatedTransaction.status === 'failed' || updatedTransaction.status === 'timeout') {
            if (booking.status === 'pending_payment') {
                booking.payment.status = 'failed';
                await booking.save();
            }
            return res.status(200).json({ message: 'Payment failure recorded.' });
        }

        if (updatedTransaction.status === 'cancelled') {
            return res.status(200).json({ message: 'Payment cancellation recorded.' });
        }

        return res.status(200).json({ message: 'Webhook accepted. Payment still pending.' });
    } catch (error) {
        return res.status(500).json({ message: 'Server error.' });
    }
};
