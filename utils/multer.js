const multer = require('multer');
const path = require('path');

const FILE_RULES = {
    license: {
        dir: 'documents',
        mime: ['application/pdf', 'image/jpeg', 'image/png'],
        ext: ['.pdf', '.jpg', '.jpeg', '.png']
    },
    idDocument: {
        dir: 'documents',
        mime: ['application/pdf', 'image/jpeg', 'image/png'],
        ext: ['.pdf', '.jpg', '.jpeg', '.png']
    },
    businessCertificate: {
        dir: 'documents',
        mime: ['application/pdf', 'image/jpeg', 'image/png'],
        ext: ['.pdf', '.jpg', '.jpeg', '.png']
    },
    taxComplianceCertificate: {
        dir: 'documents',
        mime: ['application/pdf', 'image/jpeg', 'image/png'],
        ext: ['.pdf', '.jpg', '.jpeg', '.png']
    },
    propertyProof: {
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

const buildUploadError = (message, statusCode = 400) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

const getFileRule = (file) => FILE_RULES[file.fieldname] || null;

const fileFilter = (req, file, cb) => {
    const rule = getFileRule(file);
    if (!rule) {
        return cb(buildUploadError('Unsupported upload field.'));
    }

    const extension = path.extname(file.originalname).toLowerCase();
    const validMime = rule.mime.includes(file.mimetype);
    const validExtension = rule.ext.includes(extension);

    if (!validMime || !validExtension) {
        return cb(buildUploadError(`Invalid file type for this upload. Allowed types: ${rule.ext.join(', ')}`));
    }

    cb(null, true);
};

const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }
});

const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const IMAGE_EXT  = ['.jpg', '.jpeg', '.png', '.webp'];

const imageFileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!IMAGE_MIME.includes(file.mimetype) || !IMAGE_EXT.includes(ext)) {
        return cb(buildUploadError('Only JPEG, PNG and WebP images are allowed.'));
    }
    cb(null, true);
};

const uploadImages = multer({
    storage: multer.memoryStorage(),
    fileFilter: imageFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }
});

const LICENSE_MEM_MIME = ['application/pdf', 'image/jpeg', 'image/png'];
const LICENSE_MEM_EXT  = ['.pdf', '.jpg', '.jpeg', '.png'];

const licenseFileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!LICENSE_MEM_MIME.includes(file.mimetype) || !LICENSE_MEM_EXT.includes(ext)) {
        return cb(buildUploadError('Only PDF, JPG, and PNG files are allowed for licenses.'));
    }
    cb(null, true);
};

const uploadLicense = multer({
    storage: multer.memoryStorage(),
    fileFilter: licenseFileFilter,
    limits: { fileSize: 10 * 1024 * 1024 }
});

module.exports = upload;
module.exports.upload = upload;
module.exports.uploadImages = uploadImages;
module.exports.uploadLicense = uploadLicense;
