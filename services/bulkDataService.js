const AuditLog = require('../models/AuditLog');
const Booking = require('../models/Booking');
const Hostel = require('../models/Hostel');
const Owner = require('../models/Owners');
const PaymentTransaction = require('../models/PaymentTransaction');
const Student = require('../models/Students');
const { hashPassword } = require('../helpers/passwordHelper');
const {
    MAX_IMPORT_ROWS,
    MAX_EXPORT_ROWS,
    parseCsv,
    toCsvValue
} = require('../helpers/adminOperationsHelper');

const buildImportError = (message) => ({
    message: String(message)
});

const importCsvData = async ({ dataType, csvText }) => {
    const rows = parseCsv(csvText);
    if (rows.length === 0) {
        throw new Error('CSV file has no importable rows.');
    }

    if (rows.length > MAX_IMPORT_ROWS) {
        throw new Error(`CSV exceeds the maximum of ${MAX_IMPORT_ROWS} rows per import.`);
    }

    const errorMessages = [];
    let created = 0;
    let skipped = 0;

    if (dataType === 'users') {
        for (const row of rows) {
            const role = String(row.role || '').toLowerCase();
            const username = String(row.username || '').trim();
            const email = String(row.email || '').trim().toLowerCase();
            const password = String(row.password || '').trim() || 'ChangeMe123';

            if (!username || !email || !['student', 'owner'].includes(role)) {
                skipped += 1;
                errorMessages.push(buildImportError(`Invalid user row for email ${email || 'unknown'}`).message);
                continue;
            }

            if (role === 'student') {
                if (await Student.findOne({ email })) {
                    skipped += 1;
                    continue;
                }
                await Student.create({
                    username,
                    email,
                    password: await hashPassword(password),
                    phone: String(row.phone || '').trim(),
                    isEmailVerified: true
                });
            } else {
                if (await Owner.findOne({ email })) {
                    skipped += 1;
                    continue;
                }
                await Owner.create({
                    username,
                    email,
                    password: await hashPassword(password),
                    phone: String(row.phone || '').trim(),
                    isEmailVerified: true,
                    businessLicense: String(row.businesslicense || row.business_license || 'private/documents/imports/generated-license.pdf'),
                    isApproved: String(row.isapproved || 'false').toLowerCase() === 'true'
                });
            }
            created += 1;
        }
    } else if (dataType === 'hostels') {
        for (const row of rows) {
            const ownerEmail = String(row.owneremail || row.owner_email || '').trim().toLowerCase();
            const owner = await Owner.findOne({ email: ownerEmail });
            if (!owner) {
                skipped += 1;
                errorMessages.push(buildImportError(`Owner not found for hostel ${row.name || 'unknown'}`).message);
                continue;
            }

            const name = String(row.name || '').trim();
            if (!name) {
                skipped += 1;
                continue;
            }

            const existing = await Hostel.findOne({ owner: owner._id, name });
            if (existing) {
                skipped += 1;
                continue;
            }

            await Hostel.create({
                name,
                description: String(row.description || 'Imported hostel').trim(),
                owner: owner._id,
                location: {
                    type: 'Point',
                    coordinates: [Number(row.longitude || 36.8219), Number(row.latitude || -1.2921)],
                    address: String(row.address || '').trim(),
                    city: String(row.city || 'Nairobi').trim(),
                    nearbyUniversity: String(row.nearbyuniversity || row.nearby_university || '').trim()
                },
                pricePerMonth: Number(row.pricepermonth || row.price_per_month || 0),
                hostelType: row.hosteltype || row.hostel_type || 'mixed',
                totalRooms: Number(row.totalrooms || row.total_rooms || 0),
                availableRooms: Number(row.availablerooms || row.available_rooms || 0),
                amenities: {},
                images: [],
                isApproved: String(row.isapproved || 'false').toLowerCase() === 'true',
                isActive: String(row.isactive || 'true').toLowerCase() !== 'false',
                contactPhone: String(row.contactphone || row.contact_phone || owner.phone || '').trim(),
                contactEmail: String(row.contactemail || row.contact_email || owner.email).trim()
            });
            created += 1;
        }
    } else if (dataType === 'bookings') {
        for (const row of rows) {
            const studentEmail = String(row.studentemail || row.student_email || '').trim().toLowerCase();
            const hostelName = String(row.hostelname || row.hostel_name || '').trim();
            const student = await Student.findOne({ email: studentEmail });
            const hostel = await Hostel.findOne({ name: hostelName }).populate('owner');
            if (!student || !hostel) {
                skipped += 1;
                errorMessages.push(buildImportError(`Invalid booking row for ${studentEmail || hostelName}`).message);
                continue;
            }

            const startDate = new Date(row.startdate || row.start_date);
            const endDate = new Date(row.enddate || row.end_date);
            if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
                skipped += 1;
                continue;
            }

            await Booking.create({
                hostel: hostel._id,
                student: student._id,
                owner: hostel.owner._id,
                roomsBooked: Number(row.roomsbooked || row.rooms_booked || 1),
                startDate,
                endDate,
                amount: Number(row.amount || hostel.pricePerMonth || 0),
                status: row.status || 'confirmed',
                payment: {
                    method: row.paymentmethod || row.payment_method || 'card',
                    status: row.paymentstatus || row.payment_status || 'paid'
                }
            });
            created += 1;
        }
    } else {
        throw new Error('Unsupported import data type.');
    }

    return {
        summary: {
            created,
            skipped,
            failed: errorMessages.length
        },
        errorMessages
    };
};

const buildExportCsv = async ({ type }) => {
    let rows = [];

    if (type === 'users') {
        const [students, owners] = await Promise.all([
            Student.find().select('username email phone createdAt').limit(MAX_EXPORT_ROWS),
            Owner.find().select('username email phone isApproved createdAt').limit(MAX_EXPORT_ROWS)
        ]);
        rows = [
            ['role', 'username', 'email', 'phone', 'isApproved', 'createdAt'],
            ...students.map((item) => ['student', item.username, item.email, item.phone || '', '', item.createdAt.toISOString()]),
            ...owners.map((item) => ['owner', item.username, item.email, item.phone || '', item.isApproved, item.createdAt.toISOString()])
        ];
    } else if (type === 'hostels') {
        const hostels = await Hostel.find().populate('owner', 'email').limit(MAX_EXPORT_ROWS);
        rows = [
            ['name', 'ownerEmail', 'pricePerMonth', 'totalRooms', 'availableRooms', 'isApproved', 'isActive'],
            ...hostels.map((item) => [item.name, item.owner?.email || '', item.pricePerMonth, item.totalRooms, item.availableRooms, item.isApproved, item.isActive])
        ];
    } else if (type === 'bookings') {
        const bookings = await Booking.find().populate('student', 'email').populate('hostel', 'name').limit(MAX_EXPORT_ROWS);
        rows = [
            ['studentEmail', 'hostelName', 'startDate', 'endDate', 'amount', 'status'],
            ...bookings.map((item) => [item.student?.email || '', item.hostel?.name || '', item.startDate.toISOString(), item.endDate.toISOString(), item.amount, item.status])
        ];
    } else if (type === 'payments') {
        const payments = await PaymentTransaction.find().populate('booking', '_id').limit(MAX_EXPORT_ROWS);
        rows = [
            ['bookingId', 'provider', 'amount', 'status', 'createdAt'],
            ...payments.map((item) => [item.booking?._id || '', item.provider, item.amount, item.status, item.createdAt.toISOString()])
        ];
    } else if (type === 'audit') {
        const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(MAX_EXPORT_ROWS);
        rows = [
            ['action', 'target', 'type', 'actorEmail', 'createdAt'],
            ...logs.map((item) => [item.action, item.target, item.type, item.actorEmail || '', item.createdAt.toISOString()])
        ];
    } else {
        throw new Error('Unsupported export type.');
    }

    return {
        fileName: `${type}-export.csv`,
        csv: rows.map((row) => row.map(toCsvValue).join(',')).join('\n')
    };
};

module.exports = {
    importCsvData,
    buildExportCsv
};
