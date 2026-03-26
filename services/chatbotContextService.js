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
                paymentStatus: booking.payment?.status || 'pending',
                paymentMethod: booking.payment?.method || null,
                amount: booking.amount,
                currency: booking.currency || 'KES',
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
                approvedHostelCountSample: 0,
                universityCoverageSample: [],
                citiesSample: []
            }
        };
    }

    const hostels = await Hostel.find({ isApproved: true, isActive: true })
        .select('location.nearbyUniversity location.city pricePerMonth availableRooms')
        .limit(20)
        .lean();

    const universities = [...new Set(
        hostels
            .map((hostel) => hostel.location?.nearbyUniversity)
            .filter(Boolean)
    )].slice(0, 10);

    return {
        livePlatformSnapshot: {
            approvedHostelCountSample: hostels.length,
            universityCoverageSample: universities,
            citiesSample: [...new Set(
                hostels.map((hostel) => hostel.location?.city).filter(Boolean)
            )].slice(0, 10)
        }
    };
};

const buildContext = async ({ user, clientContext }) => {
    const sanitizedClientContext = sanitizeClientContext(clientContext);
    const groundedContext = {
        ...DEFAULT_PLATFORM_CONTEXT,
        ...sanitizedClientContext,
        userRole: user?.role || 'guest'
    };

    const [platformSnapshot, roleSpecificContext] = await Promise.all([
        buildPlatformSnapshot(),
        user?.role === 'student'
            ? buildStudentContext(user.id)
            : user?.role === 'owner'
                ? buildOwnerContext(user.id)
                : Promise.resolve({ roleContext: { role: user?.role || 'guest' } })
    ]);

    return {
        ...groundedContext,
        ...platformSnapshot,
        ...roleSpecificContext
    };
};

module.exports = { buildContext };
