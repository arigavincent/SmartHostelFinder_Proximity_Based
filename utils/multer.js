const multer = require('multer');
const fs = require('fs');
const path = require('path');

// ── Disk storage — business license documents ────────────────────────────────
const LICENSE_RULES = {
    license: {
        dir: 'documents',
        mime: ['application/pdf', 'image/jpeg', 'image/png'],
        ext: ['.pdf', '.jpg', '.jpeg', '.png']
    }
};

const diskStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const rule = LICENSE_RULES[file.fieldname];
        if (!rule) return cb(new Error('Unsupported upload field.'));
        const uploadDir = path.join('uploads', rule.dir);
        fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    }
});

const diskFileFilter = (req, file, cb) => {
    const rule = LICENSE_RULES[file.fieldname];
    if (!rule) return cb(new Error('Unsupported upload field.'));
    const ext = path.extname(file.originalname).toLowerCase();
    if (!rule.mime.includes(file.mimetype) || !rule.ext.includes(ext)) {
        return cb(new Error('Invalid file type for this upload.'));
    }
    cb(null, true);
};

// Disk-based uploader (for owner license)
const upload = multer({
    storage: diskStorage,
    fileFilter: diskFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }
});

// ── Memory storage — hostel images → Cloudinary ──────────────────────────────
const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const IMAGE_EXT  = ['.jpg', '.jpeg', '.png', '.webp'];

const imageFileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!IMAGE_MIME.includes(file.mimetype) || !IMAGE_EXT.includes(ext)) {
        return cb(new Error('Only JPEG, PNG and WebP images are allowed.'));
    }
    cb(null, true);
};

// Memory-based uploader (buffers handed to Cloudinary in controller)
const uploadImages = multer({
    storage: multer.memoryStorage(),
    fileFilter: imageFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }
});

// ── Memory storage — business license → Cloudinary ────────────────────────────
const LICENSE_MEM_MIME = ['application/pdf', 'image/jpeg', 'image/png'];
const LICENSE_MEM_EXT  = ['.pdf', '.jpg', '.jpeg', '.png'];

const licenseFileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!LICENSE_MEM_MIME.includes(file.mimetype) || !LICENSE_MEM_EXT.includes(ext)) {
        return cb(new Error('Only PDF, JPG, and PNG files are allowed for licenses.'));
    }
    cb(null, true);
};

// Memory-based uploader for owner license (buffer handed to Cloudinary in controller)
const uploadLicense = multer({
    storage: multer.memoryStorage(),
    fileFilter: licenseFileFilter,
    limits: { fileSize: 10 * 1024 * 1024 } // 10 MB — documents can be larger
});

module.exports = { upload, uploadImages, uploadLicense };
