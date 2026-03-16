const Booking = require('../models/Booking');
const Caretaker = require('../models/Caretaker');
const Conversation = require('../models/Conversation');
const Expense = require('../models/Expense');
const Hostel = require('../models/Hostel');
const HostelMarketingMetric = require('../models/HostelMarketingMetric');
const Lease = require('../models/Lease');
const MaintenanceRequest = require('../models/MaintenanceRequest');
const MoveChecklist = require('../models/MoveChecklist');

const TRAFFIC_SOURCE_KEYS = ['search', 'direct', 'socialMedia', 'referral', 'university'];

const ensureOwnerHostel = async (ownerId, hostelId) => Hostel.findOne({ _id: hostelId, owner: ownerId });

const normalizeDate = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const startOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1);

const monthLabel = (date) => date.toLocaleString('en-US', { month: 'short' });

const yearMonthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const addMonths = (date, months) => new Date(date.getFullYear(), date.getMonth() + months, 1);

const getMonthsRange = (count) => {
    const now = new Date();
    const current = startOfMonth(now);
    return Array.from({ length: count }).map((_, index) => addMonths(current, index - (count - 1)));
};

const computeLeaseStatus = (lease) => {
    if (lease.archivedAt) {
        return { status: 'archived', daysRemaining: 0 };
    }

    const today = new Date();
    const endDate = new Date(lease.endDate);
    const msRemaining = endDate.setHours(23, 59, 59, 999) - today.getTime();
    const daysRemaining = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));

    if (daysRemaining <= 0) {
        return { status: 'expired', daysRemaining: 0 };
    }

    if (daysRemaining <= 30) {
        return { status: 'expiring', daysRemaining };
    }

    return { status: 'active', daysRemaining };
};

const serializeLease = (lease) => {
    const meta = computeLeaseStatus(lease);
    return {
        ...lease.toJSON(),
        status: meta.status,
        daysRemaining: meta.daysRemaining
    };
};

const serializeConversation = (conversation) => {
    const lastMessage = conversation.messages[conversation.messages.length - 1] || null;
    return {
        ...conversation.toJSON(),
        lastMessage: lastMessage ? lastMessage.text : '',
        lastMessageTime: lastMessage ? lastMessage.createdAt : conversation.lastMessageAt
    };
};

const serializeChecklist = (record) => ({
    ...record.toJSON(),
    hostelName: record.hostel?.name || ''
});

const serializeMaintenance = (request) => ({
    ...request.toJSON(),
    hostelName: request.hostel?.name || ''
});

const serializeExpense = (expense) => ({
    ...expense.toJSON(),
    hostelName: expense.hostel?.name || ''
});

const serializeCaretaker = (caretaker) => ({
    ...caretaker.toJSON(),
    hostelName: caretaker.hostel?.name || 'All Properties'
});

const getOwnerHostels = async (ownerId) => Hostel.find({ owner: ownerId }).select('name pricePerMonth availableRooms totalRooms roomTypes createdAt').lean();

const ensureMarketingMetric = async (ownerId, hostelId) => {
    let metric = await HostelMarketingMetric.findOne({ hostel: hostelId, owner: ownerId });
    if (!metric) {
        metric = await HostelMarketingMetric.create({ owner: ownerId, hostel: hostelId });
    }
    return metric;
};

exports.listMaintenance = async (req, res) => {
    try {
        const requests = await MaintenanceRequest.find({ owner: req.user.id })
            .populate('hostel', 'name')
            .sort({ createdAt: -1 });

        const resolved = requests.filter((request) => request.status === 'resolved');
        const averageResolutionDays = resolved.length === 0
            ? 0
            : resolved.reduce((sum, request) => {
                const endDate = request.resolvedAt || request.updatedAt;
                const diff = endDate.getTime() - request.createdAt.getTime();
                return sum + diff / (1000 * 60 * 60 * 24);
            }, 0) / resolved.length;

        res.status(200).json({
            requests: requests.map(serializeMaintenance),
            stats: {
                open: requests.filter((request) => request.status === 'open').length,
                in_progress: requests.filter((request) => request.status === 'in_progress').length,
                resolved: resolved.length,
                urgent: requests.filter((request) => request.priority === 'urgent' && request.status !== 'resolved').length,
                averageResolutionDays: Number(averageResolutionDays.toFixed(1))
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.createMaintenance = async (req, res) => {
    try {
        const {
            hostelId,
            tenantName,
            tenantPhone,
            roomLabel,
            category,
            description,
            priority,
            assignedTo
        } = req.body;

        if (!hostelId || !tenantName || !category || !description) {
            return res.status(400).json({ message: 'Hostel, tenant name, category, and description are required.' });
        }

        const hostel = await ensureOwnerHostel(req.user.id, hostelId);
        if (!hostel) {
            return res.status(404).json({ message: 'Hostel not found.' });
        }

        const request = await MaintenanceRequest.create({
            owner: req.user.id,
            hostel: hostel._id,
            tenantName: String(tenantName).trim(),
            tenantPhone: String(tenantPhone || '').trim(),
            roomLabel: String(roomLabel || '').trim(),
            category: String(category).trim(),
            description: String(description).trim(),
            priority: priority || 'medium',
            assignedTo: String(assignedTo || '').trim()
        });

        const populated = await request.populate('hostel', 'name');
        res.status(201).json({
            message: 'Maintenance request logged successfully.',
            request: serializeMaintenance(populated)
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.updateMaintenance = async (req, res) => {
    try {
        const request = await MaintenanceRequest.findOne({ _id: req.params.id, owner: req.user.id }).populate('hostel', 'name');
        if (!request) {
            return res.status(404).json({ message: 'Maintenance request not found.' });
        }

        const allowedFields = ['tenantName', 'tenantPhone', 'roomLabel', 'category', 'description', 'priority', 'status', 'assignedTo'];
        allowedFields.forEach((field) => {
            if (req.body[field] !== undefined) {
                request[field] = typeof req.body[field] === 'string' ? req.body[field].trim() : req.body[field];
            }
        });

        if (request.status === 'resolved') {
            request.resolvedAt = request.resolvedAt || new Date();
        } else {
            request.resolvedAt = undefined;
        }

        await request.save();

        res.status(200).json({
            message: 'Maintenance request updated successfully.',
            request: serializeMaintenance(request)
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.listLeases = async (req, res) => {
    try {
        const leases = await Lease.find({ owner: req.user.id })
            .populate('hostel', 'name')
            .sort({ endDate: 1 });

        const serialized = leases.map(serializeLease);

        res.status(200).json({
            leases: serialized,
            stats: {
                active: serialized.filter((lease) => lease.status === 'active').length,
                expiring: serialized.filter((lease) => lease.status === 'expiring').length,
                expired: serialized.filter((lease) => lease.status === 'expired').length,
                monthlyRevenue: serialized
                    .filter((lease) => lease.status !== 'expired' && lease.status !== 'archived')
                    .reduce((sum, lease) => sum + Number(lease.monthlyRent || 0), 0)
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.createLease = async (req, res) => {
    try {
        const {
            hostelId,
            tenantName,
            tenantEmail,
            roomLabel,
            startDate,
            endDate,
            monthlyRent
        } = req.body;

        if (!hostelId || !tenantName || !startDate || !endDate || monthlyRent === undefined) {
            return res.status(400).json({ message: 'Hostel, tenant name, dates, and monthly rent are required.' });
        }

        const hostel = await ensureOwnerHostel(req.user.id, hostelId);
        if (!hostel) {
            return res.status(404).json({ message: 'Hostel not found.' });
        }

        const start = normalizeDate(startDate);
        const end = normalizeDate(endDate);
        if (!start || !end || end < start) {
            return res.status(400).json({ message: 'Lease dates are invalid.' });
        }

        const lease = await Lease.create({
            owner: req.user.id,
            hostel: hostel._id,
            tenantName: String(tenantName).trim(),
            tenantEmail: String(tenantEmail || '').trim(),
            roomLabel: String(roomLabel || '').trim(),
            startDate: start,
            endDate: end,
            monthlyRent: Number(monthlyRent)
        });

        const populated = await lease.populate('hostel', 'name');
        res.status(201).json({
            message: 'Lease created successfully.',
            lease: serializeLease(populated)
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.updateLease = async (req, res) => {
    try {
        const lease = await Lease.findOne({ _id: req.params.id, owner: req.user.id }).populate('hostel', 'name');
        if (!lease) {
            return res.status(404).json({ message: 'Lease not found.' });
        }

        if (req.body.action === 'archive') {
            lease.archivedAt = new Date();
        }

        if (req.body.endDate !== undefined) {
            const endDate = normalizeDate(req.body.endDate);
            if (!endDate) {
                return res.status(400).json({ message: 'Invalid lease end date.' });
            }
            lease.endDate = endDate;
            lease.archivedAt = undefined;
        }

        if (req.body.monthlyRent !== undefined) {
            lease.monthlyRent = Number(req.body.monthlyRent);
        }

        if (req.body.tenantName !== undefined) {
            lease.tenantName = String(req.body.tenantName).trim();
        }

        if (req.body.tenantEmail !== undefined) {
            lease.tenantEmail = String(req.body.tenantEmail).trim();
        }

        if (req.body.roomLabel !== undefined) {
            lease.roomLabel = String(req.body.roomLabel).trim();
        }

        await lease.save();

        res.status(200).json({
            message: 'Lease updated successfully.',
            lease: serializeLease(lease)
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.listExpenses = async (req, res) => {
    try {
        const expenses = await Expense.find({ owner: req.user.id })
            .populate('hostel', 'name')
            .sort({ date: -1, createdAt: -1 });

        const months = getMonthsRange(6);
        const trendByMonth = new Map(months.map((date) => [yearMonthKey(date), { month: monthLabel(date), amount: 0 }]));

        expenses.forEach((expense) => {
            const key = yearMonthKey(new Date(expense.date));
            if (trendByMonth.has(key)) {
                trendByMonth.get(key).amount += Number(expense.amount || 0);
            }
        });

        const categoryTotals = new Map();
        expenses.forEach((expense) => {
            const category = expense.category || 'Other';
            categoryTotals.set(category, (categoryTotals.get(category) || 0) + Number(expense.amount || 0));
        });

        res.status(200).json({
            expenses: expenses.map(serializeExpense),
            total: expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
            trend: Array.from(trendByMonth.values()),
            categories: Array.from(categoryTotals.entries()).map(([name, value]) => ({ name, value }))
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.createExpense = async (req, res) => {
    try {
        const { hostelId, category, description, amount, date } = req.body;

        if (!hostelId || !category || !description || amount === undefined || !date) {
            return res.status(400).json({ message: 'Hostel, category, description, amount, and date are required.' });
        }

        const hostel = await ensureOwnerHostel(req.user.id, hostelId);
        if (!hostel) {
            return res.status(404).json({ message: 'Hostel not found.' });
        }

        const expenseDate = normalizeDate(date);
        if (!expenseDate) {
            return res.status(400).json({ message: 'Invalid expense date.' });
        }

        const expense = await Expense.create({
            owner: req.user.id,
            hostel: hostel._id,
            category: String(category).trim(),
            description: String(description).trim(),
            amount: Number(amount),
            date: expenseDate
        });

        const populated = await expense.populate('hostel', 'name');
        res.status(201).json({
            message: 'Expense recorded successfully.',
            expense: serializeExpense(populated)
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.deleteExpense = async (req, res) => {
    try {
        const expense = await Expense.findOneAndDelete({ _id: req.params.id, owner: req.user.id });
        if (!expense) {
            return res.status(404).json({ message: 'Expense not found.' });
        }

        res.status(200).json({ message: 'Expense deleted successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.listCaretakers = async (req, res) => {
    try {
        const caretakers = await Caretaker.find({ owner: req.user.id })
            .populate('hostel', 'name')
            .sort({ createdAt: -1 });

        res.status(200).json({
            caretakers: caretakers.map(serializeCaretaker)
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.createCaretaker = async (req, res) => {
    try {
        const { hostelId, name, phone, email, roleTitle, rating, status } = req.body;

        if (!name || !phone || !roleTitle) {
            return res.status(400).json({ message: 'Name, phone, and role are required.' });
        }

        let hostel = null;
        if (hostelId) {
            hostel = await ensureOwnerHostel(req.user.id, hostelId);
            if (!hostel) {
                return res.status(404).json({ message: 'Hostel not found.' });
            }
        }

        const caretaker = await Caretaker.create({
            owner: req.user.id,
            hostel: hostel?._id,
            name: String(name).trim(),
            phone: String(phone).trim(),
            email: String(email || '').trim(),
            roleTitle: String(roleTitle).trim(),
            rating: rating !== undefined ? Number(rating) : 5,
            status: status || 'active'
        });

        const populated = await caretaker.populate('hostel', 'name');
        res.status(201).json({
            message: 'Caretaker created successfully.',
            caretaker: serializeCaretaker(populated)
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.updateCaretaker = async (req, res) => {
    try {
        const caretaker = await Caretaker.findOne({ _id: req.params.id, owner: req.user.id }).populate('hostel', 'name');
        if (!caretaker) {
            return res.status(404).json({ message: 'Caretaker not found.' });
        }

        const allowedFields = ['name', 'phone', 'email', 'roleTitle', 'status'];
        allowedFields.forEach((field) => {
            if (req.body[field] !== undefined) {
                caretaker[field] = String(req.body[field]).trim();
            }
        });

        if (req.body.rating !== undefined) {
            caretaker.rating = Number(req.body.rating);
        }

        if (req.body.hostelId !== undefined) {
            if (!req.body.hostelId) {
                caretaker.hostel = undefined;
            } else {
                const hostel = await ensureOwnerHostel(req.user.id, req.body.hostelId);
                if (!hostel) {
                    return res.status(404).json({ message: 'Hostel not found.' });
                }
                caretaker.hostel = hostel._id;
            }
        }

        await caretaker.save();
        await caretaker.populate('hostel', 'name');

        res.status(200).json({
            message: 'Caretaker updated successfully.',
            caretaker: serializeCaretaker(caretaker)
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.deleteCaretaker = async (req, res) => {
    try {
        const caretaker = await Caretaker.findOneAndDelete({ _id: req.params.id, owner: req.user.id });
        if (!caretaker) {
            return res.status(404).json({ message: 'Caretaker not found.' });
        }

        res.status(200).json({ message: 'Caretaker removed successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.listConversations = async (req, res) => {
    try {
        const conversations = await Conversation.find({ owner: req.user.id })
            .populate('hostel', 'name')
            .sort({ lastMessageAt: -1 });

        res.status(200).json({
            conversations: conversations.map(serializeConversation)
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.createConversation = async (req, res) => {
    try {
        const { hostelId, tenantName, tenantPhone, tenantEmail, initialMessage } = req.body;

        if (!tenantName || !initialMessage) {
            return res.status(400).json({ message: 'Tenant name and initial message are required.' });
        }

        let hostel = null;
        if (hostelId) {
            hostel = await ensureOwnerHostel(req.user.id, hostelId);
            if (!hostel) {
                return res.status(404).json({ message: 'Hostel not found.' });
            }
        }

        const now = new Date();
        const conversation = await Conversation.create({
            owner: req.user.id,
            hostel: hostel?._id,
            tenantName: String(tenantName).trim(),
            tenantPhone: String(tenantPhone || '').trim(),
            tenantEmail: String(tenantEmail || '').trim(),
            unreadCountOwner: 1,
            lastMessageAt: now,
            messages: [{
                sender: 'tenant',
                text: String(initialMessage).trim(),
                createdAt: now
            }]
        });

        const populated = await conversation.populate('hostel', 'name');
        res.status(201).json({
            message: 'Conversation created successfully.',
            conversation: serializeConversation(populated)
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.sendConversationMessage = async (req, res) => {
    try {
        const conversation = await Conversation.findOne({ _id: req.params.id, owner: req.user.id }).populate('hostel', 'name');
        if (!conversation) {
            return res.status(404).json({ message: 'Conversation not found.' });
        }

        const text = String(req.body.text || '').trim();
        const sender = req.body.sender === 'tenant' ? 'tenant' : 'owner';

        if (!text) {
            return res.status(400).json({ message: 'Message text is required.' });
        }

        const now = new Date();
        conversation.messages.push({ sender, text, createdAt: now });
        conversation.lastMessageAt = now;
        conversation.unreadCountOwner = sender === 'tenant'
            ? conversation.unreadCountOwner + 1
            : 0;

        await conversation.save();

        res.status(200).json({
            message: 'Message sent successfully.',
            conversation: serializeConversation(conversation)
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.markConversationRead = async (req, res) => {
    try {
        const conversation = await Conversation.findOneAndUpdate(
            { _id: req.params.id, owner: req.user.id },
            { $set: { unreadCountOwner: 0 } },
            { new: true }
        ).populate('hostel', 'name');

        if (!conversation) {
            return res.status(404).json({ message: 'Conversation not found.' });
        }

        res.status(200).json({
            conversation: serializeConversation(conversation)
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.listChecklists = async (req, res) => {
    try {
        const checklists = await MoveChecklist.find({ owner: req.user.id })
            .populate('hostel', 'name')
            .sort({ date: -1, createdAt: -1 });

        res.status(200).json({
            records: checklists.map(serializeChecklist)
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.createChecklist = async (req, res) => {
    try {
        const {
            hostelId,
            tenantName,
            roomLabel,
            type,
            date,
            status,
            deposit,
            deductions,
            items
        } = req.body;

        if (!hostelId || !tenantName || !roomLabel || !type || !date) {
            return res.status(400).json({ message: 'Hostel, tenant name, room, type, and date are required.' });
        }

        const hostel = await ensureOwnerHostel(req.user.id, hostelId);
        if (!hostel) {
            return res.status(404).json({ message: 'Hostel not found.' });
        }

        const checklist = await MoveChecklist.create({
            owner: req.user.id,
            hostel: hostel._id,
            tenantName: String(tenantName).trim(),
            roomLabel: String(roomLabel).trim(),
            type,
            date: normalizeDate(date),
            status: status || 'pending',
            deposit: Number(deposit || 0),
            deductions: Number(deductions || 0),
            items: Array.isArray(items) ? items : []
        });

        const populated = await checklist.populate('hostel', 'name');
        res.status(201).json({
            message: 'Checklist created successfully.',
            record: serializeChecklist(populated)
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.updateChecklist = async (req, res) => {
    try {
        const checklist = await MoveChecklist.findOne({ _id: req.params.id, owner: req.user.id }).populate('hostel', 'name');
        if (!checklist) {
            return res.status(404).json({ message: 'Checklist not found.' });
        }

        const allowedFields = ['tenantName', 'roomLabel', 'type', 'status'];
        allowedFields.forEach((field) => {
            if (req.body[field] !== undefined) {
                checklist[field] = typeof req.body[field] === 'string' ? req.body[field].trim() : req.body[field];
            }
        });

        if (req.body.date !== undefined) {
            checklist.date = normalizeDate(req.body.date);
        }

        if (req.body.deposit !== undefined) {
            checklist.deposit = Number(req.body.deposit);
        }

        if (req.body.deductions !== undefined) {
            checklist.deductions = Number(req.body.deductions);
        }

        if (req.body.items !== undefined && Array.isArray(req.body.items)) {
            checklist.items = req.body.items;
        }

        await checklist.save();

        res.status(200).json({
            message: 'Checklist updated successfully.',
            record: serializeChecklist(checklist)
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.downloadChecklistReport = async (req, res) => {
    try {
        const checklist = await MoveChecklist.findOne({ _id: req.params.id, owner: req.user.id }).populate('hostel', 'name');
        if (!checklist) {
            return res.status(404).json({ message: 'Checklist not found.' });
        }

        const lines = [
            `Checklist ID,${checklist._id}`,
            `Hostel,${checklist.hostel?.name || ''}`,
            `Tenant,${checklist.tenantName}`,
            `Room,${checklist.roomLabel}`,
            `Type,${checklist.type}`,
            `Status,${checklist.status}`,
            `Date,${new Date(checklist.date).toISOString()}`,
            `Deposit,${checklist.deposit}`,
            `Deductions,${checklist.deductions}`,
            '',
            'Area,Condition,Notes,Photo Taken'
        ];

        checklist.items.forEach((item) => {
            lines.push(
                `"${String(item.area || '').replace(/"/g, '""')}","${String(item.condition || '').replace(/"/g, '""')}","${String(item.notes || '').replace(/"/g, '""')}",${item.photoTaken ? 'Yes' : 'No'}`
            );
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="checklist-${checklist._id}.csv"`);
        res.status(200).send(lines.join('\n'));
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.listMarketing = async (req, res) => {
    try {
        const hostels = await getOwnerHostels(req.user.id);
        const hostelIds = hostels.map((hostel) => hostel._id);
        const [metrics, confirmedBookings, conversations] = await Promise.all([
            HostelMarketingMetric.find({ owner: req.user.id, hostel: { $in: hostelIds } }).lean(),
            Booking.find({ owner: req.user.id, hostel: { $in: hostelIds }, status: 'confirmed' }).select('hostel createdAt amount'),
            Conversation.find({ owner: req.user.id, hostel: { $in: hostelIds } }).select('hostel')
        ]);

        const metricMap = new Map(metrics.map((metric) => [String(metric.hostel), metric]));
        const inquiryMap = new Map();
        conversations.forEach((conversation) => {
            if (!conversation.hostel) return;
            const key = String(conversation.hostel);
            inquiryMap.set(key, (inquiryMap.get(key) || 0) + 1);
        });

        const bookingMap = new Map();
        confirmedBookings.forEach((booking) => {
            const key = String(booking.hostel);
            bookingMap.set(key, bookingMap.get(key) || []);
            bookingMap.get(key).push(booking);
        });

        const vacancies = hostels
            .filter((hostel) => Number(hostel.availableRooms || 0) > 0)
            .map((hostel) => {
                const metric = metricMap.get(String(hostel._id)) || {};
                const bookings = bookingMap.get(String(hostel._id)) || [];
                const lastOccupiedAt = bookings.length > 0
                    ? bookings.reduce((latest, booking) => latest > booking.createdAt ? latest : booking.createdAt, bookings[0].createdAt)
                    : hostel.createdAt;
                const daysVacant = Math.max(0, Math.ceil((Date.now() - new Date(lastOccupiedAt).getTime()) / (1000 * 60 * 60 * 24)));

                return {
                    hostelId: hostel._id,
                    hostel: hostel.name,
                    type: hostel.roomTypes?.[0]?.type || 'room',
                    price: hostel.pricePerMonth || 0,
                    availableRooms: hostel.availableRooms || 0,
                    daysVacant,
                    sharesTotal: metric.sharesTotal || 0,
                    boostsTotal: metric.boostsTotal || 0,
                    lastBoostedAt: metric.lastBoostedAt || null
                };
            });

        const trafficSourceTotals = {
            search: 0,
            direct: 0,
            socialMedia: 0,
            referral: 0,
            university: 0
        };

        metrics.forEach((metric) => {
            TRAFFIC_SOURCE_KEYS.forEach((key) => {
                trafficSourceTotals[key] += Number(metric.trafficSources?.[key] || 0);
            });
        });

        const totalViews = metrics.reduce((sum, metric) => sum + Number(metric.viewsTotal || 0), 0);
        const totalInquiries = Array.from(inquiryMap.values()).reduce((sum, value) => sum + value, 0);
        const totalConfirmedBookings = confirmedBookings.length;

        res.status(200).json({
            totals: {
                vacancies: vacancies.reduce((sum, item) => sum + Number(item.availableRooms || 0), 0),
                views: totalViews,
                inquiries: totalInquiries,
                conversionRate: totalViews > 0 ? Number(((totalConfirmedBookings / totalViews) * 100).toFixed(1)) : 0
            },
            trafficSources: [
                { source: 'Search', views: trafficSourceTotals.search },
                { source: 'Direct', views: trafficSourceTotals.direct },
                { source: 'Social Media', views: trafficSourceTotals.socialMedia },
                { source: 'Referral', views: trafficSourceTotals.referral },
                { source: 'University', views: trafficSourceTotals.university }
            ],
            vacancies
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.boostListing = async (req, res) => {
    try {
        const hostel = await ensureOwnerHostel(req.user.id, req.params.hostelId);
        if (!hostel) {
            return res.status(404).json({ message: 'Hostel not found.' });
        }

        const metric = await ensureMarketingMetric(req.user.id, hostel._id);
        metric.boostsTotal += 1;
        metric.lastBoostedAt = new Date();
        metric.viewsTotal += 5;
        metric.trafficSources.direct += 5;
        await metric.save();

        res.status(200).json({
            message: 'Listing boosted successfully.'
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.shareListing = async (req, res) => {
    try {
        const hostel = await ensureOwnerHostel(req.user.id, req.params.hostelId);
        if (!hostel) {
            return res.status(404).json({ message: 'Hostel not found.' });
        }

        const metric = await ensureMarketingMetric(req.user.id, hostel._id);
        metric.sharesTotal += 1;
        metric.lastSharedAt = new Date();
        metric.viewsTotal += 2;
        metric.trafficSources.socialMedia += 2;
        await metric.save();

        res.status(200).json({
            message: 'Listing share recorded successfully.'
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.getRevenueReport = async (req, res) => {
    try {
        const [bookings, expenses, hostels] = await Promise.all([
            Booking.find({ owner: req.user.id, status: 'confirmed' })
                .populate('hostel', 'name')
                .select('hostel amount startDate createdAt'),
            Expense.find({ owner: req.user.id }).populate('hostel', 'name').select('hostel amount date'),
            Hostel.find({ owner: req.user.id }).select('name')
        ]);

        const months = getMonthsRange(8);
        const monthlyMap = new Map(months.map((date) => [yearMonthKey(date), {
            month: monthLabel(date),
            income: 0,
            expenses: 0
        }]));

        bookings.forEach((booking) => {
            const bookingDate = new Date(booking.startDate || booking.createdAt);
            const key = yearMonthKey(bookingDate);
            if (monthlyMap.has(key)) {
                monthlyMap.get(key).income += Number(booking.amount || 0);
            }
        });

        expenses.forEach((expense) => {
            const expenseDate = new Date(expense.date);
            const key = yearMonthKey(expenseDate);
            if (monthlyMap.has(key)) {
                monthlyMap.get(key).expenses += Number(expense.amount || 0);
            }
        });

        const hostelTotals = new Map(hostels.map((hostel) => [String(hostel._id), { name: hostel.name, revenue: 0 }]));
        bookings.forEach((booking) => {
            const key = String(booking.hostel?._id || booking.hostel);
            if (hostelTotals.has(key)) {
                hostelTotals.get(key).revenue += Number(booking.amount || 0);
            }
        });

        const totalIncome = bookings.reduce((sum, booking) => sum + Number(booking.amount || 0), 0);
        const totalExpenses = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
        const netProfit = totalIncome - totalExpenses;

        res.status(200).json({
            monthlyRevenue: Array.from(monthlyMap.values()),
            hostelRevenue: Array.from(hostelTotals.values()).filter((item) => item.revenue > 0),
            totals: {
                income: totalIncome,
                expenses: totalExpenses,
                netProfit,
                profitMargin: totalIncome > 0 ? Number(((netProfit / totalIncome) * 100).toFixed(1)) : 0
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.exportRevenueReport = async (req, res) => {
    try {
        const [bookings, expenses] = await Promise.all([
            Booking.find({ owner: req.user.id, status: 'confirmed' }).populate('hostel', 'name').select('hostel amount startDate createdAt'),
            Expense.find({ owner: req.user.id }).populate('hostel', 'name').select('hostel amount date category description')
        ]);

        const lines = ['Type,Hostel,Date,Amount,Category,Description'];

        bookings.forEach((booking) => {
            lines.push(`Income,"${booking.hostel?.name || ''}",${new Date(booking.startDate || booking.createdAt).toISOString()},${Number(booking.amount || 0)},Booking,Confirmed booking`);
        });

        expenses.forEach((expense) => {
            lines.push(`Expense,"${expense.hostel?.name || ''}",${new Date(expense.date).toISOString()},${Number(expense.amount || 0)},"${String(expense.category || '').replace(/"/g, '""')}","${String(expense.description || '').replace(/"/g, '""')}"`);
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="owner-revenue-report.csv"');
        res.status(200).send(lines.join('\n'));
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
};
