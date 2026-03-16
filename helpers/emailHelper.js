const nodemailer = require('nodemailer');

// Create transporter
const createTransporter = () => {
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });
};

const buildEmailShell = ({ heading, intro, body, footer = '' }) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">${heading}</h2>
        <p>${intro}</p>
        ${body}
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #999; font-size: 12px;">${footer || 'SmartHostelFinder Team'}</p>
    </div>
`;

const buildVerificationEmail = (email, username, verificationToken) => {
    const verificationUrl = `${process.env.CLIENT_URL}/verify-email?token=${verificationToken}`;

    return {
        to: email,
        subject: 'Verify Your Email - SmartHostelFinder',
        html: buildEmailShell({
            heading: 'Welcome to SmartHostelFinder!',
            intro: `Hi ${username},`,
            body: `
                <p>Thank you for registering. Please verify your email address by clicking the button below:</p>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${verificationUrl}" 
                       style="background-color: #4CAF50; color: white; padding: 12px 30px; 
                              text-decoration: none; border-radius: 5px; display: inline-block;">
                        Verify Email
                    </a>
                </div>
                <p>Or copy and paste this link in your browser:</p>
                <p style="color: #666; word-break: break-all;">${verificationUrl}</p>
                <p>This link will expire in 24 hours.</p>
            `
        })
    };
};

const buildPasswordResetEmail = (email, username, resetToken) => {
    const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;

    return {
        to: email,
        subject: 'Password Reset Request - SmartHostelFinder',
        html: buildEmailShell({
            heading: 'Password Reset Request',
            intro: `Hi ${username},`,
            body: `
                <p>We received a request to reset your password. Click the button below to create a new password:</p>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${resetUrl}" 
                       style="background-color: #2196F3; color: white; padding: 12px 30px; 
                              text-decoration: none; border-radius: 5px; display: inline-block;">
                        Reset Password
                    </a>
                </div>
                <p>Or copy and paste this link in your browser:</p>
                <p style="color: #666; word-break: break-all;">${resetUrl}</p>
                <p>This link will expire in 1 hour.</p>
            `
        })
    };
};

const buildApprovalEmail = (email, username, isApproved, rejectionReason = '') => {
    const subject = isApproved
        ? 'Account Approved - SmartHostelFinder'
        : 'Account Application Update - SmartHostelFinder';

    const message = isApproved
        ? 'Congratulations! Your hostel owner account has been approved. You can now log in and start listing your hostels.'
        : `We regret to inform you that your hostel owner application was not approved${rejectionReason ? `: ${rejectionReason}` : ' at this time.'}`;

    return {
        to: email,
        subject,
        html: buildEmailShell({
            heading: 'Account Status Update',
            intro: `Hi ${username},`,
            body: `
                <p>${message}</p>
                ${isApproved ? `
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${process.env.CLIENT_URL}/login" 
                       style="background-color: #4CAF50; color: white; padding: 12px 30px; 
                              text-decoration: none; border-radius: 5px; display: inline-block;">
                        Login Now
                    </a>
                </div>
                ` : ''}
            `
        })
    };
};

/**
 * Send email verification link
 */
const sendVerificationEmail = async (email, username, verificationToken) => {
    const transporter = createTransporter();
    const verificationUrl = `${process.env.CLIENT_URL}/verify-email?token=${verificationToken}`;

    const mailOptions = {
        from: `"SmartHostelFinder" <${process.env.SMTP_USER}>`,
        to: email,
        subject: 'Verify Your Email - SmartHostelFinder',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #333;">Welcome to SmartHostelFinder!</h2>
                <p>Hi ${username},</p>
                <p>Thank you for registering. Please verify your email address by clicking the button below:</p>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${verificationUrl}" 
                       style="background-color: #4CAF50; color: white; padding: 12px 30px; 
                              text-decoration: none; border-radius: 5px; display: inline-block;">
                        Verify Email
                    </a>
                </div>
                <p>Or copy and paste this link in your browser:</p>
                <p style="color: #666; word-break: break-all;">${verificationUrl}</p>
                <p>This link will expire in 24 hours.</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                <p style="color: #999; font-size: 12px;">If you didn't create an account, please ignore this email.</p>
            </div>
        `
    };

    return await transporter.sendMail(mailOptions);
};

/**
 * Send password reset link
 */
const sendPasswordResetEmail = async (email, username, resetToken) => {
    const transporter = createTransporter();
    const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;

    const mailOptions = {
        from: `"SmartHostelFinder" <${process.env.SMTP_USER}>`,
        to: email,
        subject: 'Password Reset Request - SmartHostelFinder',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #333;">Password Reset Request</h2>
                <p>Hi ${username},</p>
                <p>We received a request to reset your password. Click the button below to create a new password:</p>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${resetUrl}" 
                       style="background-color: #2196F3; color: white; padding: 12px 30px; 
                              text-decoration: none; border-radius: 5px; display: inline-block;">
                        Reset Password
                    </a>
                </div>
                <p>Or copy and paste this link in your browser:</p>
                <p style="color: #666; word-break: break-all;">${resetUrl}</p>
                <p>This link will expire in 1 hour.</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                <p style="color: #999; font-size: 12px;">If you didn't request a password reset, please ignore this email.</p>
            </div>
        `
    };

    return await transporter.sendMail(mailOptions);
};

/**
 * Send owner approval notification
 */
const sendApprovalEmail = async (email, username, isApproved) => {
    const transporter = createTransporter();

    const subject = isApproved 
        ? 'Account Approved - SmartHostelFinder' 
        : 'Account Application Update - SmartHostelFinder';

    const message = isApproved
        ? 'Congratulations! Your hostel owner account has been approved. You can now log in and start listing your hostels.'
        : 'We regret to inform you that your hostel owner application was not approved at this time.';

    const mailOptions = {
        from: `"SmartHostelFinder" <${process.env.SMTP_USER}>`,
        to: email,
        subject: subject,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #333;">Account Status Update</h2>
                <p>Hi ${username},</p>
                <p>${message}</p>
                ${isApproved ? `
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${process.env.CLIENT_URL}/login" 
                       style="background-color: #4CAF50; color: white; padding: 12px 30px; 
                              text-decoration: none; border-radius: 5px; display: inline-block;">
                        Login Now
                    </a>
                </div>
                ` : ''}
                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                <p style="color: #999; font-size: 12px;">SmartHostelFinder Team</p>
            </div>
        `
    };

    return await transporter.sendMail(mailOptions);
};

/**
 * Send owner suspension notification
 */
const sendSuspensionEmail = async (email, username) => {
    const transporter = createTransporter();

    const mailOptions = {
        from: `"SmartHostelFinder" <${process.env.SMTP_USER}>`,
        to: email,
        subject: 'Account Suspended - SmartHostelFinder',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #d32f2f;">Account Suspended</h2>
                <p>Hi ${username},</p>
                <p>Your SmartHostelFinder owner account has been suspended by an administrator.</p>
                <p>If you believe this is a mistake, please contact support.</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                <p style="color: #999; font-size: 12px;">SmartHostelFinder Team</p>
            </div>
        `
    };

    return await transporter.sendMail(mailOptions);
};

/**
 * Send booking confirmation email to student
 */
const sendBookingConfirmationEmail = async (email, username, bookingDetails) => {
    const transporter = createTransporter();
    const {
        hostelName,
        hostelAddress,
        startDate,
        endDate,
        roomsBooked,
        amount,
        currency,
        paymentMethod,
        paymentReference,
        receiptNumber,
    } = bookingDetails;

    const fmtDate = (d) => new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' });
    const fmtAmount = (a, c) => `${c || 'KES'} ${Number(a).toLocaleString('en-KE')}`;

    const mailOptions = {
        from: `"SmartHostelFinder" <${process.env.SMTP_USER}>`,
        to: email,
        subject: `Booking Confirmed – ${hostelName} | SmartHostelFinder`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                <div style="background: linear-gradient(135deg,#1d4ed8,#2563eb); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
                    <h1 style="color: #fff; margin: 0; font-size: 24px;">Booking Confirmed!</h1>
                    <p style="color: #bfdbfe; margin: 8px 0 0;">Your payment was received successfully</p>
                </div>
                <div style="background: #fff; padding: 28px 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                    <p style="margin: 0 0 20px;">Hi <strong>${username}</strong>,</p>
                    <p style="margin: 0 0 24px; color: #4b5563;">Thank you for your booking at <strong>${hostelName}</strong>. Here are your booking details:</p>

                    <table style="width:100%; border-collapse: collapse; margin-bottom: 24px;">
                        <tr style="background:#f3f4f6;">
                            <td style="padding: 10px 14px; font-weight: bold; font-size: 13px; color:#374151;">Hostel</td>
                            <td style="padding: 10px 14px; font-size: 13px; color:#111827;">${hostelName}${hostelAddress ? ' — ' + hostelAddress : ''}</td>
                        </tr>
                        <tr>
                            <td style="padding: 10px 14px; font-weight: bold; font-size: 13px; color:#374151;">Check-in</td>
                            <td style="padding: 10px 14px; font-size: 13px; color:#111827;">${fmtDate(startDate)}</td>
                        </tr>
                        <tr style="background:#f3f4f6;">
                            <td style="padding: 10px 14px; font-weight: bold; font-size: 13px; color:#374151;">Check-out</td>
                            <td style="padding: 10px 14px; font-size: 13px; color:#111827;">${fmtDate(endDate)}</td>
                        </tr>
                        <tr>
                            <td style="padding: 10px 14px; font-weight: bold; font-size: 13px; color:#374151;">Rooms Booked</td>
                            <td style="padding: 10px 14px; font-size: 13px; color:#111827;">${roomsBooked}</td>
                        </tr>
                        <tr style="background:#f3f4f6;">
                            <td style="padding: 10px 14px; font-weight: bold; font-size: 13px; color:#374151;">Amount Paid</td>
                            <td style="padding: 10px 14px; font-size: 13px; font-weight: bold; color:#16a34a;">${fmtAmount(amount, currency)}</td>
                        </tr>
                        <tr>
                            <td style="padding: 10px 14px; font-weight: bold; font-size: 13px; color:#374151;">Payment Method</td>
                            <td style="padding: 10px 14px; font-size: 13px; color:#111827; text-transform: uppercase;">${paymentMethod}</td>
                        </tr>
                        ${paymentReference ? `
                        <tr style="background:#f3f4f6;">
                            <td style="padding: 10px 14px; font-weight: bold; font-size: 13px; color:#374151;">Payment Reference</td>
                            <td style="padding: 10px 14px; font-size: 13px; font-family: monospace; color:#111827;">${paymentReference}</td>
                        </tr>` : ''}
                        ${receiptNumber ? `
                        <tr${paymentReference ? '' : ' style="background:#f3f4f6;"'}>
                            <td style="padding: 10px 14px; font-weight: bold; font-size: 13px; color:#374151;">Receipt No.</td>
                            <td style="padding: 10px 14px; font-size: 13px; font-family: monospace; color:#111827;">${receiptNumber}</td>
                        </tr>` : ''}
                    </table>

                    <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px; padding:14px 16px; margin-bottom:24px;">
                        <p style="margin:0; color:#166534; font-size:13px;">
                            ✓ Your room is reserved and your booking is now <strong>confirmed</strong>.
                            You can log in to your dashboard to view or download your receipt at any time.
                        </p>
                    </div>

                    <div style="text-align:center; margin-bottom: 24px;">
                        <a href="${process.env.CLIENT_URL}/student/bookings"
                           style="background:#2563eb; color:#fff; padding:12px 28px; text-decoration:none; border-radius:6px; font-weight:bold; display:inline-block;">
                            View My Bookings
                        </a>
                    </div>

                    <hr style="border:none; border-top:1px solid #e5e7eb; margin:20px 0;">
                    <p style="color:#9ca3af; font-size:12px; margin:0;">SmartHostelFinder &mdash; Smart accommodation for smart students.</p>
                </div>
            </div>
        `,
    };

    return await transporter.sendMail(mailOptions);
};

module.exports = {
    sendVerificationEmail,
    sendPasswordResetEmail,
    sendApprovalEmail,
    sendSuspensionEmail,
    sendBookingConfirmationEmail,
    buildVerificationEmail,
    buildPasswordResetEmail,
    buildApprovalEmail,
};
