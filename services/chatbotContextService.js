const mongoose = require('mongoose');

const Booking = require('../models/Booking');
const Complaint = require('../models/Complaint');
const Hostel = require('../models/Hostel');
const Owner = require('../models/Owners');
const PaymentTransaction = require('../models/PaymentTransaction');
const Student = require('../models/Students');
const SupportTicket = require('../models/SupportTicket');

const DEFAULT_PLATFORM_CONTEXT = {
    app: 'Smart Hostel Finder',
    primaryUniversity: 'Kirinyaga University',
    universityAliases: ['KyU', 'Kirinyaga University'],
    primaryUniversityNote: 'Kirinyaga University is the main test university for this system, but the assistant can still discuss other universities generally.',
    supportedCapabilities: [
        'hostel_search_guidance',
        'booking_guidance',
        'payment_guidance',
        'cancellation_guidance',
        'support_guidance'
    ],
    paymentMethods: ['mpesa', 'card'],
    currency: 'KES'
};

const normalizeSearchText = (value) => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const STOP_TOKENS = new Set([
    'hostel',
    'hostels',
    'about',
    'tell',
    'give',
    'what',
    'which',
    'this',
    'that',
    'near',
    'show',
    'details',
    'detail',
    'info',
    'information',
    'can',
    'you',
    'me'
]);

const SEARCH_TOKENS = [
    'show',
    'find',
    'list',
    'which',
    'search',
    'near',
    'nearby',
    'available',
    'availability',
    'vacancy',
    'vacancies',
    'compare'
];

const pickTruthyAmenities = (amenities = {}) => Object.entries(amenities)
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key);

const topValues = (values = [], limit = 3) => {
    const counts = new Map();
    for (const value of values.filter(Boolean)) {
        counts.set(value, (counts.get(value) || 0) + 1);
    }

    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
        .slice(0, limit)
        .map(([value, count]) => ({ value, count }));
};

const summarizePriceBand = (values = []) => {
    const prices = values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0);

    if (prices.length === 0) {
        return null;
    }

    return {
        min: Math.min(...prices),
        max: Math.max(...prices)
    };
};

const buildPublicHostelSummary = (hostel) => ({
    name: hostel.name,
    description: hostel.description,
    nearbyUniversity: hostel.location?.nearbyUniversity || null,
    city: hostel.location?.city || null,
    pricePerMonth: hostel.pricePerMonth,
    availableRooms: hostel.availableRooms,
    averageRating: hostel.averageRating || 0,
    hostelType: hostel.hostelType || null,
    amenities: pickTruthyAmenities(hostel.amenities)
});

const isDatabaseReady = () => mongoose.connection.readyState === 1;

const sanitizeClientContext = (context) => {
    if (!context || typeof context !== 'object' || Array.isArray(context)) {
        return {};
    }

    return { ...context };
};

const findMatchingLabel = (normalizedMessage, labels = [], aliasesByLabel = new Map()) => {
    for (const label of labels) {
        if (!label || typeof label !== 'string') {
            continue;
        }

        const candidates = new Set([normalizeSearchText(label)]);
        for (const alias of aliasesByLabel.get(label) || []) {
            candidates.add(normalizeSearchText(alias));
        }

        if ([...candidates].some((candidate) => candidate && normalizedMessage.includes(candidate))) {
            return label;
        }
    }

    return null;
};

const hasSearchIntent = (normalizedMessage) => SEARCH_TOKENS.some((token) => normalizedMessage.includes(token));

const buildStudentContext = async (userId) => {
    if (!isDatabaseReady() || !mongoose.isValidObjectId(userId)) {
        return {
            roleContext: {
                role: 'student',
                accountFound: false
            }
        };
    }

    const student = await Student.findById(userId)
        .select('username email phone favorites')
        .populate({
            path: 'favorites',
            select: 'name location.nearbyUniversity location.city pricePerMonth availableRooms amenities averageRating'
        });

    if (!student) {
        return {
            roleContext: {
                role: 'student',
                accountFound: false
            }
        };
    }

    const recentBookings = await Booking.find({ student: userId })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate({
            path: 'hostel',
            select: 'name location.nearbyUniversity location.city pricePerMonth'
        });

    const recentPayments = await PaymentTransaction.find({ student: userId })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('provider status amount currency failureReason booking createdAt')
        .lean();

    const favoriteCities = (student.favorites || []).map((hostel) => hostel.location?.city).filter(Boolean);
    const favoriteUniversities = (student.favorites || []).map((hostel) => hostel.location?.nearbyUniversity).filter(Boolean);
    const favoritePrices = (student.favorites || []).map((hostel) => hostel.pricePerMonth);
    const bookingPrices = recentBookings.map((booking) => booking.hostel?.pricePerMonth).filter(Boolean);

    const bookingActionSummary = {
        totalRecentBookings: recentBookings.length,
        pendingPaymentBookings: recentBookings.filter((booking) => booking.status === 'pending_payment').length,
        confirmedBookings: recentBookings.filter((booking) => booking.status === 'confirmed').length,
        cancellableBookings: recentBookings.filter((booking) => booking.status !== 'cancelled').length,
        failedPaymentBookings: recentBookings.filter((booking) => booking.payment?.status === 'failed').length
    };

    const nextActions = [];
    if (bookingActionSummary.pendingPaymentBookings > 0) {
        nextActions.push('complete_payment_confirmation');
    }
    if (bookingActionSummary.failedPaymentBookings > 0) {
        nextActions.push('retry_or_verify_failed_payment');
    }
    if (bookingActionSummary.cancellableBookings > 0) {
        nextActions.push('review_active_bookings_for_cancellation');
    }

    return {
        roleContext: {
            role: 'student',
            accountFound: true,
            profile: {
                username: student.username,
                email: student.email,
                phone: student.phone || null
            },
            favorites: (student.favorites || []).slice(0, 5).map((hostel) => ({
                name: hostel.name,
                nearbyUniversity: hostel.location?.nearbyUniversity || null,
                city: hostel.location?.city || null,
                pricePerMonth: hostel.pricePerMonth,
                availableRooms: hostel.availableRooms,
                averageRating: hostel.averageRating || 0,
                amenities: pickTruthyAmenities(hostel.amenities)
            })),
            recentBookings: recentBookings.map((booking) => ({
                bookingId: String(booking._id),
                status: booking.status,
                roomsBooked: booking.roomsBooked,
                paymentStatus: booking.payment?.status || 'pending',
                paymentMethod: booking.payment?.method || null,
                amount: booking.amount,
                currency: booking.currency || 'KES',
                startDate: booking.startDate ? booking.startDate.toISOString().slice(0, 10) : null,
                endDate: booking.endDate ? booking.endDate.toISOString().slice(0, 10) : null,
                hostel: booking.hostel ? {
                    name: booking.hostel.name,
                    nearbyUniversity: booking.hostel.location?.nearbyUniversity || null,
                    city: booking.hostel.location?.city || null,
                    pricePerMonth: booking.hostel.pricePerMonth
                } : null
            })),
            bookingActionSummary,
            recommendationSignals: {
                preferredCities: topValues(favoriteCities, 3),
                preferredUniversities: topValues(favoriteUniversities, 3),
                priceBand: summarizePriceBand([...favoritePrices, ...bookingPrices]),
                nextActions
            },
            recentPayments: recentPayments.map((payment) => ({
                bookingId: payment.booking ? String(payment.booking) : null,
                provider: payment.provider,
                status: payment.status,
                amount: payment.amount,
                currency: payment.currency || 'KES',
                failureReason: payment.failureReason || null,
                createdAt: payment.createdAt ? payment.createdAt.toISOString() : null
            }))
        }
    };
};

const buildOwnerContext = async (userId) => {
    if (!isDatabaseReady() || !mongoose.isValidObjectId(userId)) {
        return {
            roleContext: {
                role: 'owner',
                accountFound: false
            }
        };
    }

    const owner = await Owner.findById(userId)
        .select('username email phone isApproved isSuspended verification.status')
        .lean();

    if (!owner) {
        return {
            roleContext: {
                role: 'owner',
                accountFound: false
            }
        };
    }

    const hostels = await Hostel.find({ owner: userId })
        .select('name location.nearbyUniversity location.city pricePerMonth totalRooms availableRooms isApproved isActive amenities')
        .sort({ createdAt: -1 })
        .lean();

    const recentOwnerBookings = await Booking.find({ owner: userId })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate({
            path: 'hostel',
            select: 'name'
        })
        .lean();

    const ownerStats = {
        totalHostels: hostels.length,
        approvedHostels: hostels.filter((hostel) => hostel.isApproved).length,
        pendingHostels: hostels.filter((hostel) => !hostel.isApproved).length,
        inactiveHostels: hostels.filter((hostel) => !hostel.isActive).length,
        lowAvailabilityHostels: hostels.filter((hostel) => Number(hostel.availableRooms || 0) > 0 && Number(hostel.availableRooms || 0) <= 2).length,
        zeroRoomHostels: hostels.filter((hostel) => Number(hostel.availableRooms || 0) === 0).length,
        availableRooms: hostels.reduce((sum, hostel) => sum + Number(hostel.availableRooms || 0), 0),
        totalRooms: hostels.reduce((sum, hostel) => sum + Number(hostel.totalRooms || 0), 0),
        recentBookings: recentOwnerBookings.length,
        pendingPaymentBookings: recentOwnerBookings.filter((booking) => booking.status === 'pending_payment').length
    };

    return {
        roleContext: {
            role: 'owner',
            accountFound: true,
            profile: {
                username: owner.username,
                email: owner.email,
                phone: owner.phone || null,
                isApproved: Boolean(owner.isApproved),
                isSuspended: Boolean(owner.isSuspended),
                verificationStatus: owner.verification?.status || 'not_submitted'
            },
            stats: ownerStats,
            hostels: hostels.slice(0, 8).map((hostel) => ({
                name: hostel.name,
                nearbyUniversity: hostel.location?.nearbyUniversity || null,
                city: hostel.location?.city || null,
                pricePerMonth: hostel.pricePerMonth,
                totalRooms: hostel.totalRooms,
                availableRooms: hostel.availableRooms,
                isApproved: Boolean(hostel.isApproved),
                isActive: Boolean(hostel.isActive),
                amenities: pickTruthyAmenities(hostel.amenities)
            })),
            hostelsNeedingAttention: {
                pendingApproval: hostels
                    .filter((hostel) => !hostel.isApproved)
                    .slice(0, 5)
                    .map((hostel) => hostel.name),
                inactive: hostels
                    .filter((hostel) => !hostel.isActive)
                    .slice(0, 5)
                    .map((hostel) => hostel.name),
                lowAvailability: hostels
                    .filter((hostel) => Number(hostel.availableRooms || 0) > 0 && Number(hostel.availableRooms || 0) <= 2)
                    .slice(0, 5)
                    .map((hostel) => ({
                        name: hostel.name,
                        availableRooms: hostel.availableRooms
                    })),
                zeroRooms: hostels
                    .filter((hostel) => Number(hostel.availableRooms || 0) === 0)
                    .slice(0, 5)
                    .map((hostel) => hostel.name)
            },
            recentBookingSummary: {
                confirmed: recentOwnerBookings.filter((booking) => booking.status === 'confirmed').length,
                pendingPayment: recentOwnerBookings.filter((booking) => booking.status === 'pending_payment').length,
                cancelled: recentOwnerBookings.filter((booking) => booking.status === 'cancelled').length
            },
            releasableReservations: recentOwnerBookings
                .filter((booking) => booking.status === 'pending_payment' && booking.payment?.status !== 'paid')
                .slice(0, 5)
                .map((booking) => ({
                    bookingId: String(booking._id),
                    hostelName: booking.hostel?.name || null,
                    paymentStatus: booking.payment?.status || 'pending',
                    amount: booking.amount,
                    currency: booking.currency || 'KES'
                }))
        }
    };
};

const buildAdminContext = async () => {
    if (!isDatabaseReady()) {
        return {
            roleContext: {
                role: 'admin',
                dashboardStats: {
                    totalStudents: 0,
                    totalOwners: 0,
                    approvedOwners: 0,
                    pendingOwners: 0,
                    totalHostels: 0,
                    approvedHostels: 0,
                    pendingHostels: 0
                }
            }
        };
    }

    const [
        totalStudents,
        totalOwners,
        approvedOwners,
        pendingOwners,
        totalHostels,
        approvedHostels,
        pendingHostels,
        openTickets,
        inProgressTickets,
        openComplaints,
        investigatingComplaints,
        recentHostels,
        pendingOwnerQueue,
        pendingHostelQueue
    ] = await Promise.all([
        Student.countDocuments(),
        Owner.countDocuments(),
        Owner.countDocuments({ isApproved: true }),
        Owner.countDocuments({ 'verification.status': 'submitted' }),
        Hostel.countDocuments(),
        Hostel.countDocuments({ isApproved: true }),
        Hostel.countDocuments({ isApproved: false }),
        SupportTicket.countDocuments({ status: 'open' }),
        SupportTicket.countDocuments({ status: 'in_progress' }),
        Complaint.countDocuments({ status: 'open' }),
        Complaint.countDocuments({ status: 'investigating' }),
        Hostel.find().sort({ createdAt: -1 }).limit(5).select('name isApproved isActive createdAt').lean(),
        Owner.find({ 'verification.status': 'submitted' })
            .sort({ createdAt: 1 })
            .limit(5)
            .select('username email verification.submittedAt')
            .lean(),
        Hostel.find({ isApproved: false })
            .sort({ createdAt: 1 })
            .limit(5)
            .select('name createdAt')
            .lean()
    ]);

    return {
        roleContext: {
            role: 'admin',
            dashboardStats: {
                totalStudents,
                totalOwners,
                approvedOwners,
                pendingOwners,
                totalHostels,
                approvedHostels,
                pendingHostels
            },
            moderationSummary: {
                openTickets,
                inProgressTickets,
                openComplaints,
                investigatingComplaints
            },
            recentHostels: recentHostels.map((hostel) => ({
                name: hostel.name,
                isApproved: Boolean(hostel.isApproved),
                isActive: Boolean(hostel.isActive),
                createdAt: hostel.createdAt ? hostel.createdAt.toISOString() : null
            })),
            pendingQueues: {
                owners: pendingOwnerQueue.map((owner) => ({
                    username: owner.username,
                    email: owner.email,
                    submittedAt: owner.verification?.submittedAt ? owner.verification.submittedAt.toISOString() : null
                })),
                hostels: pendingHostelQueue.map((hostel) => ({
                    name: hostel.name,
                    createdAt: hostel.createdAt ? hostel.createdAt.toISOString() : null
                }))
            }
        }
    };
};

const buildPlatformSnapshot = async () => {
    if (!isDatabaseReady()) {
        return {
            livePlatformSnapshot: {
                approvedActiveHostelCount: 0,
                approvedHostelCountSample: 0,
                universityCoverage: [],
                universityCoverageSample: [],
                cityCoverage: [],
                hostelsByUniversity: [],
                hostelsByCity: [],
                cheapestHostel: null,
                featuredHostels: [],
                citiesSample: []
            }
        };
    }

    const approvedFilter = { isApproved: true, isActive: true };
    const [approvedActiveHostelCount, hostels, byUniversity, byCity, cheapestHostel] = await Promise.all([
        Hostel.countDocuments(approvedFilter),
        Hostel.find(approvedFilter)
            .select('name location.nearbyUniversity location.city pricePerMonth availableRooms averageRating')
            .sort({ createdAt: -1 })
            .limit(12)
            .lean(),
        Hostel.aggregate([
            { $match: approvedFilter },
            { $match: { 'location.nearbyUniversity': { $type: 'string', $ne: '' } } },
            { $group: { _id: '$location.nearbyUniversity', count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } }
        ]),
        Hostel.aggregate([
            { $match: approvedFilter },
            { $match: { 'location.city': { $type: 'string', $ne: '' } } },
            { $group: { _id: '$location.city', count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } }
        ]),
        Hostel.findOne(approvedFilter)
            .select('name description location.nearbyUniversity location.city pricePerMonth availableRooms averageRating amenities hostelType')
            .sort({ pricePerMonth: 1, availableRooms: -1, averageRating: -1, createdAt: -1 })
            .lean()
    ]);

    const universities = [...new Set(
        byUniversity
            .map((entry) => entry._id)
            .filter(Boolean)
    )];
    const cities = [...new Set(
        byCity
            .map((entry) => entry._id)
            .filter(Boolean)
    )];

    return {
        livePlatformSnapshot: {
            approvedActiveHostelCount,
            approvedHostelCountSample: approvedActiveHostelCount,
            universityCoverage: universities,
            universityCoverageSample: universities.slice(0, 10),
            cityCoverage: cities,
            citiesSample: cities.slice(0, 10),
            hostelsByUniversity: byUniversity
                .slice(0, 20)
                .map((entry) => ({
                    university: entry._id,
                    count: entry.count
                })),
            hostelsByCity: byCity
                .slice(0, 20)
                .map((entry) => ({
                    city: entry._id,
                    count: entry.count
                })),
            cheapestHostel: cheapestHostel ? buildPublicHostelSummary(cheapestHostel) : null,
            featuredHostels: hostels.map((hostel) => ({
                ...buildPublicHostelSummary(hostel)
            }))
        }
    };
};

const scoreHostelNameMatch = (message, hostelName) => {
    const normalizedMessage = normalizeSearchText(message);
    const normalizedHostelName = normalizeSearchText(hostelName);

    if (!normalizedMessage || !normalizedHostelName) {
        return 0;
    }

    if (normalizedMessage.includes(normalizedHostelName)) {
        return 100;
    }

    const messageTokens = new Set(normalizedMessage.split(' ').filter(Boolean));
    const hostelTokens = normalizedHostelName
        .split(' ')
        .filter((token) => token && token.length > 2 && !STOP_TOKENS.has(token));

    if (hostelTokens.length === 0) {
        return 0;
    }

    const matchedTokens = hostelTokens.filter((token) => messageTokens.has(token));
    if (matchedTokens.length === 0) {
        return 0;
    }

    return matchedTokens.length * 20 + (matchedTokens.length === hostelTokens.length ? 20 : 0);
};

const buildResolvedHostelContext = async (message) => {
    const normalizedMessage = normalizeSearchText(message);
    if (!isDatabaseReady() || !normalizedMessage) {
        return {};
    }

    const publicHostels = await Hostel.find({ isApproved: true, isActive: true })
        .select('name description location.nearbyUniversity location.city pricePerMonth availableRooms averageRating amenities hostelType')
        .limit(100)
        .lean();

    let bestMatch = null;
    let bestScore = 0;
    for (const hostel of publicHostels) {
        const score = scoreHostelNameMatch(normalizedMessage, hostel.name);
        if (score > bestScore) {
            bestMatch = hostel;
            bestScore = score;
        }
    }

    if (!bestMatch || bestScore < 20) {
        return {};
    }

    return {
        resolvedHostelMatch: buildPublicHostelSummary(bestMatch)
    };
};

const buildMatchedHostelsContext = async (message, context = {}) => {
    const normalizedMessage = normalizeSearchText(message);
    if (!isDatabaseReady() || !normalizedMessage) {
        return {};
    }

    const publicHostels = await Hostel.find({ isApproved: true, isActive: true })
        .select('name description location.nearbyUniversity location.city pricePerMonth availableRooms averageRating amenities hostelType')
        .limit(150)
        .lean();

    const availableUniversities = [...new Set(
        publicHostels
            .map((hostel) => hostel.location?.nearbyUniversity)
            .filter((value) => typeof value === 'string' && value.trim())
    )];
    const availableCities = [...new Set(
        publicHostels
            .map((hostel) => hostel.location?.city)
            .filter((value) => typeof value === 'string' && value.trim())
    )];

    const aliasMap = new Map();
    const primaryUniversity = typeof context.primaryUniversity === 'string' ? context.primaryUniversity : null;
    const contextAliases = Array.isArray(context.universityAliases)
        ? context.universityAliases.filter((value) => typeof value === 'string' && value.trim())
        : [];
    if (primaryUniversity) {
        aliasMap.set(primaryUniversity, contextAliases);
    }

    const targetUniversity = findMatchingLabel(normalizedMessage, availableUniversities, aliasMap);
    const targetCity = findMatchingLabel(normalizedMessage, availableCities);
    const availableOnly = containsAnyToken(normalizedMessage, ['available', 'availability', 'vacancy', 'vacancies', 'open rooms']);

    if (!hasSearchIntent(normalizedMessage) && !targetUniversity && !targetCity) {
        return {};
    }

    const matches = publicHostels
        .filter((hostel) => {
            if (targetUniversity && hostel.location?.nearbyUniversity !== targetUniversity) {
                return false;
            }
            if (targetCity && hostel.location?.city !== targetCity) {
                return false;
            }
            if (availableOnly && Number(hostel.availableRooms || 0) <= 0) {
                return false;
            }
            return true;
        })
        .sort((left, right) => {
            const leftRooms = Number(left.availableRooms || 0);
            const rightRooms = Number(right.availableRooms || 0);
            if (rightRooms !== leftRooms) {
                return rightRooms - leftRooms;
            }

            const leftRating = Number(left.averageRating || 0);
            const rightRating = Number(right.averageRating || 0);
            if (rightRating !== leftRating) {
                return rightRating - leftRating;
            }

            const leftPrice = Number(left.pricePerMonth || Number.MAX_SAFE_INTEGER);
            const rightPrice = Number(right.pricePerMonth || Number.MAX_SAFE_INTEGER);
            if (leftPrice !== rightPrice) {
                return leftPrice - rightPrice;
            }

            return String(left.name || '').localeCompare(String(right.name || ''));
        });

    if (!targetUniversity && !targetCity && !availableOnly && matches.length === 0) {
        return {};
    }

    return {
        matchedHostelQuery: {
            university: targetUniversity,
            city: targetCity,
            availableOnly,
            totalMatches: matches.length
        },
        matchedHostels: matches.slice(0, 6).map(buildPublicHostelSummary)
    };
};

const containsAnyToken = (text, tokens) => tokens.some((token) => text.includes(token));

const buildContext = async ({ user, clientContext, userMessage }) => {
    const sanitizedClientContext = sanitizeClientContext(clientContext);
    const groundedContext = {
        ...DEFAULT_PLATFORM_CONTEXT,
        ...sanitizedClientContext,
        userRole: user?.role || 'guest'
    };

    const [platformSnapshot, roleSpecificContext, resolvedHostelContext, matchedHostelsContext] = await Promise.all([
        buildPlatformSnapshot(),
        user?.role === 'student'
            ? buildStudentContext(user.id)
            : user?.role === 'owner'
                ? buildOwnerContext(user.id)
                : user?.role === 'admin'
                    ? buildAdminContext()
                : Promise.resolve({ roleContext: { role: user?.role || 'guest' } }),
        buildResolvedHostelContext(userMessage),
        buildMatchedHostelsContext(userMessage, groundedContext)
    ]);

    return {
        ...groundedContext,
        ...platformSnapshot,
        ...roleSpecificContext,
        ...resolvedHostelContext,
        ...matchedHostelsContext
    };
};

module.exports = { buildContext };
