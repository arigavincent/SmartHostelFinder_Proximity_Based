const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mime = require('mime-types');
const {
    S3Client,
    PutObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    HeadBucketCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { getRequestContext } = require('../middlewares/requestContext');

const STORAGE_PROVIDER = String(process.env.STORAGE_PROVIDER || 'local').trim().toLowerCase();
const STORAGE_LOCAL_ROOT = path.resolve(
    __dirname,
    '..',
    String(process.env.STORAGE_LOCAL_ROOT || 'storage').trim()
);
const STORAGE_SIGNED_URL_TTL_SECONDS = Math.max(
    Number(process.env.STORAGE_SIGNED_URL_TTL_SECONDS || 900),
    60
);

let cachedS3Client = null;

const trimSlashes = (value) => String(value || '').replace(/^\/+|\/+$/g, '');

const getServerBaseUrl = () => String(
    getRequestContext()?.origin
    || process.env.SERVER_URL
    || `http://localhost:${process.env.PORT || 5100}`
).replace(/\/+$/, '');

const sanitizeKey = (key) => {
    const normalized = String(key || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .split('/')
        .filter((segment) => segment && segment !== '.' && segment !== '..')
        .join('/');

    if (!normalized) {
        throw new Error('Storage key is required.');
    }

    return normalized;
};

const resolveLocalPath = (key) => {
    const safeKey = sanitizeKey(key);
    const target = path.resolve(STORAGE_LOCAL_ROOT, safeKey);
    const rootWithSep = `${STORAGE_LOCAL_ROOT}${path.sep}`;

    if (target !== STORAGE_LOCAL_ROOT && !target.startsWith(rootWithSep)) {
        throw new Error('Invalid storage key.');
    }

    return target;
};

const ensureParentDirectory = async (targetPath) => {
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
};

const guessExtension = (originalName, contentType) => {
    const fileExtension = path.extname(String(originalName || '')).toLowerCase();
    if (fileExtension) return fileExtension;

    const mimeExtension = mime.extension(contentType || '');
    return mimeExtension ? `.${mimeExtension}` : '';
};

const generateObjectKey = (scope, originalName = 'file') => {
    const safeScope = trimSlashes(scope) || 'misc';
    const baseName = path.basename(String(originalName || 'file'), path.extname(String(originalName || 'file')))
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'file';
    const extension = guessExtension(originalName, mime.lookup(originalName) || '') || '';
    const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const randomId = crypto.randomBytes(6).toString('hex');
    return sanitizeKey(`${safeScope}/${timestamp}-${randomId}-${baseName}${extension}`);
};

const getS3Client = () => {
    if (cachedS3Client) return cachedS3Client;

    cachedS3Client = new S3Client({
        region: process.env.S3_REGION || 'auto',
        endpoint: process.env.S3_ENDPOINT || undefined,
        forcePathStyle: ['1', 'true', 'yes'].includes(String(process.env.S3_FORCE_PATH_STYLE || '').toLowerCase()),
        credentials: process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
            ? {
                accessKeyId: process.env.S3_ACCESS_KEY_ID,
                secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
            }
            : undefined
    });

    return cachedS3Client;
};

const getS3Bucket = () => {
    const bucket = String(process.env.S3_BUCKET || '').trim();
    if (!bucket) {
        throw new Error('S3_BUCKET is required for object storage.');
    }
    return bucket;
};

const getPublicUrl = (key) => {
    const safeKey = sanitizeKey(key);
    if (!safeKey.startsWith('public/')) {
        throw new Error('Only public storage keys can be exposed.');
    }
    const configuredBase = trimSlashes(process.env.STORAGE_PUBLIC_BASE_URL);

    if (configuredBase) {
        return `${String(process.env.STORAGE_PUBLIC_BASE_URL).replace(/\/+$/, '')}/${safeKey}`;
    }

    return `${getServerBaseUrl()}/api/storage/public?key=${encodeURIComponent(safeKey)}`;
};

const saveBufferLocally = async ({ key, buffer }) => {
    const targetPath = resolveLocalPath(key);
    await ensureParentDirectory(targetPath);
    await fs.promises.writeFile(targetPath, buffer);
};

const saveBufferToS3 = async ({ key, buffer, contentType }) => {
    const client = getS3Client();
    await client.send(new PutObjectCommand({
        Bucket: getS3Bucket(),
        Key: sanitizeKey(key),
        Body: buffer,
        ContentType: contentType || 'application/octet-stream'
    }));
};

const saveBuffer = async ({ key, buffer, contentType }) => {
    if (!Buffer.isBuffer(buffer)) {
        throw new Error('Storage buffer is required.');
    }

    if (STORAGE_PROVIDER === 's3') {
        await saveBufferToS3({ key, buffer, contentType });
        return {
            key: sanitizeKey(key),
            url: sanitizeKey(key).startsWith('public/') ? getPublicUrl(key) : ''
        };
    }

    await saveBufferLocally({ key, buffer });
    return {
        key: sanitizeKey(key),
        url: sanitizeKey(key).startsWith('public/') ? getPublicUrl(key) : ''
    };
};

const deleteObject = async (key) => {
    const safeKey = sanitizeKey(key);

    if (STORAGE_PROVIDER === 's3') {
        const client = getS3Client();
        await client.send(new DeleteObjectCommand({
            Bucket: getS3Bucket(),
            Key: safeKey
        }));
        return;
    }

    const targetPath = resolveLocalPath(safeKey);
    if (fs.existsSync(targetPath)) {
        await fs.promises.unlink(targetPath);
    }
};

const buildLocalDownloadUrl = (key, fileName) => {
    const params = new URLSearchParams({ key: sanitizeKey(key) });
    if (fileName) {
        params.set('filename', fileName);
    }
    return `${getServerBaseUrl()}/api/storage/download?${params.toString()}`;
};

const getPrivateDownloadUrl = async (key, fileName) => {
    const safeKey = sanitizeKey(key);

    if (STORAGE_PROVIDER === 's3') {
        const client = getS3Client();
        return getSignedUrl(client, new GetObjectCommand({
            Bucket: getS3Bucket(),
            Key: safeKey,
            ResponseContentDisposition: fileName
                ? `attachment; filename="${path.basename(fileName)}"`
                : undefined
        }), { expiresIn: STORAGE_SIGNED_URL_TTL_SECONDS });
    }

    return buildLocalDownloadUrl(safeKey, fileName);
};

const sendDownload = async (res, key, fileName) => {
    const safeKey = sanitizeKey(key);

    if (STORAGE_PROVIDER === 's3') {
        const downloadUrl = await getPrivateDownloadUrl(safeKey, fileName);
        return res.redirect(downloadUrl);
    }

    const targetPath = resolveLocalPath(safeKey);
    if (!fs.existsSync(targetPath)) {
        return res.status(404).json({ message: 'Stored file not found.' });
    }

    return res.download(targetPath, fileName || path.basename(targetPath));
};

const streamPublicObject = async (res, key) => {
    const safeKey = sanitizeKey(key);
    if (!safeKey.startsWith('public/')) {
        res.status(403).json({ message: 'Storage key is not public.' });
        return;
    }

    if (STORAGE_PROVIDER === 's3') {
        const client = getS3Client();
        const object = await client.send(new GetObjectCommand({
            Bucket: getS3Bucket(),
            Key: safeKey
        }));
        if (object.ContentType) {
            res.setHeader('Content-Type', object.ContentType);
        }
        if (object.Body && typeof object.Body.pipe === 'function') {
            object.Body.pipe(res);
            return;
        }
        res.status(404).end();
        return;
    }

    const targetPath = resolveLocalPath(safeKey);
    if (!fs.existsSync(targetPath)) {
        res.status(404).json({ message: 'Stored file not found.' });
        return;
    }

    res.sendFile(targetPath);
};

const extractStorageKey = (value) => {
    if (!value) return null;
    const raw = String(value).trim();
    if (!raw) return null;

    if (!/^https?:\/\//i.test(raw)) {
        return sanitizeKey(raw);
    }

    try {
        const url = new URL(raw);
        const keyFromQuery = url.searchParams.get('key');
        if (keyFromQuery) {
            return sanitizeKey(keyFromQuery);
        }

        const pathname = url.pathname.replace(/^\/+/, '');
        const publicPrefix = trimSlashes(process.env.STORAGE_PUBLIC_BASE_URL);
        if (publicPrefix && raw.startsWith(String(process.env.STORAGE_PUBLIC_BASE_URL).replace(/\/+$/, ''))) {
            return sanitizeKey(pathname);
        }

        const uploadsIndex = pathname.indexOf('uploads/');
        if (uploadsIndex >= 0) {
            return sanitizeKey(pathname.slice(uploadsIndex));
        }
    } catch (error) {
        return null;
    }

    return null;
};

const checkHealth = async () => {
    if (STORAGE_PROVIDER === 's3') {
        const client = getS3Client();
        await client.send(new HeadBucketCommand({ Bucket: getS3Bucket() }));
        return {
            provider: 's3',
            detail: getS3Bucket()
        };
    }

    await fs.promises.mkdir(STORAGE_LOCAL_ROOT, { recursive: true });
    return {
        provider: 'local',
        detail: STORAGE_LOCAL_ROOT
    };
};

module.exports = {
    STORAGE_PROVIDER,
    STORAGE_LOCAL_ROOT,
    generateObjectKey,
    getServerBaseUrl,
    saveBuffer,
    deleteObject,
    getPublicUrl,
    getPrivateDownloadUrl,
    sendDownload,
    streamPublicObject,
    extractStorageKey,
    checkHealth
};
