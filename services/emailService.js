const nodemailer = require('nodemailer');

const createTransporter = () => nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

const sendEmailMessage = async ({ to, subject, html }) => {
    const transporter = createTransporter();
    return transporter.sendMail({
        from: `"SmartHostelFinder" <${process.env.SMTP_USER}>`,
        to,
        subject,
        html
    });
};

module.exports = { sendEmailMessage };
