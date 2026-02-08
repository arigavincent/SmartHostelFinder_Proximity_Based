const multer = require('multer');
const fs = require('fs');
const path = require('path');

const FILE_RULES = {
    license: {
        dir: 'documents',
        mime: ['application/pdf', 'image/jpeg', 'image/png'],
        ext: ['.pdf', '.jpg', '.jpeg', '.png']
    },
    images: {
        dir: 'images',
        mime: ['image/jpeg', 'image/png', 'image/webp'],
        ext: ['.jpg', '.jpeg', '.png', '.webp']
    }
};

const getFileRule = (file) => FILE_RULES[file.fieldname] || null;

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const rule = getFileRule(file);
        if (!rule) {
            return cb(new Error('Unsupported upload field.'));
        }

        const uploadDir = path.join('uploads', rule.dir);
        fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const extension = path.extname(file.originalname).toLowerCase();
        cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`);
    }
});

const fileFilter = (req, file, cb) => {
    const rule = getFileRule(file);
    if (!rule) {
        return cb(new Error('Unsupported upload field.'));
    }

    const extension = path.extname(file.originalname).toLowerCase();
    const validMime = rule.mime.includes(file.mimetype);
    const validExtension = rule.ext.includes(extension);

    if (!validMime || !validExtension) {
        return cb(new Error('Invalid file type for this upload.'));
    }

    cb(null, true);
};

const upload = multer({ 
    storage: storage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }
});

module.exports = upload;
