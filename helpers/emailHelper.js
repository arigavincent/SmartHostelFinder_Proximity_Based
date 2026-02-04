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

module.exports = {
    sendVerificationEmail,
    sendPasswordResetEmail,
    sendApprovalEmail
};
