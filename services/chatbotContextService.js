const mongoose = require('mongoose');

const Booking = require('../models/Booking');
const Hostel = require('../models/Hostel');
const Owner = require('../models/Owners');
const Student = require('../models/Students');

const DEFAULT_PLATFORM_CONTEXT = {
    app: 'Smart Hostel Finder',
    primaryUniversity: 'Kirinyaga University',
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

const pickTruthyAmenities = (amenities = {}) => Object.entries(amenities)
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key);

const isDatabaseReady = () => mongoose.connection.readyState === 1;

const sanitizeClientContext = (context) => {
    if (!context || typeof context !== 'object' || Array.isArray(context)) {
        return {};
    }

    return { ...context };
};

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
        .limit(3)
        .populate({
            path: 'hostel',
            select: 'name location.nearbyUniversity location.city pricePerMonth'
        });

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
        .select('name location.nearbyUniversity location.city pricePerMonth availableRooms isApproved isActive amenities')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

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
            hostels: hostels.map((hostel) => ({
                name: hostel.name,
                nearbyUniversity: hostel.location?.nearbyUniversity || null,
                city: hostel.location?.city || null,
                pricePerMonth: hostel.pricePerMonth,
                availableRooms: hostel.availableRooms,
                isApproved: Boolean(hostel.isApproved),
                isActive: Boolean(hostel.isActive),
                amenities: pickTruthyAmenities(hostel.amenities)
            }))
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
                featuredHostels: [],
                citiesSample: []
            }
        };
    }

    const approvedFilter = { isApproved: true, isActive: true };
    const [approvedActiveHostelCount, hostels, byUniversity, byCity] = await Promise.all([
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
        ])
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
            featuredHostels: hostels.map((hostel) => ({
                name: hostel.name,
                nearbyUniversity: hostel.location?.nearbyUniversity || null,
                city: hostel.location?.city || null,
                pricePerMonth: hostel.pricePerMonth,
                availableRooms: hostel.availableRooms,
                averageRating: hostel.averageRating || 0
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
    if (!isDatabaseReady() || !normalizedMessage || !normalizedMessage.includes('hostel')) {
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
        resolvedHostelMatch: {
            name: bestMatch.name,
            description: bestMatch.description,
            nearbyUniversity: bestMatch.location?.nearbyUniversity || null,
            city: bestMatch.location?.city || null,
            pricePerMonth: bestMatch.pricePerMonth,
            availableRooms: bestMatch.availableRooms,
            averageRating: bestMatch.averageRating || 0,
            hostelType: bestMatch.hostelType || null,
            amenities: pickTruthyAmenities(bestMatch.amenities)
        }
    };
};

const buildContext = async ({ user, clientContext, userMessage }) => {
    const sanitizedClientContext = sanitizeClientContext(clientContext);
    const groundedContext = {
        ...DEFAULT_PLATFORM_CONTEXT,
        ...sanitizedClientContext,
        userRole: user?.role || 'guest'
    };

    const [platformSnapshot, roleSpecificContext, resolvedHostelContext] = await Promise.all([
        buildPlatformSnapshot(),
        user?.role === 'student'
            ? buildStudentContext(user.id)
            : user?.role === 'owner'
                ? buildOwnerContext(user.id)
                : Promise.resolve({ roleContext: { role: user?.role || 'guest' } }),
        buildResolvedHostelContext(userMessage)
    ]);

    return {
        ...groundedContext,
        ...platformSnapshot,
        ...roleSpecificContext,
        ...resolvedHostelContext
    };
};

module.exports = { buildContext };
