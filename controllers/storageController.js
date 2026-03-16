const { sendDownload, streamPublicObject } = require('../services/storageService');

exports.getPublicObject = async (req, res) => {
    try {
        const key = String(req.query.key || '').trim();
        if (!key) {
            return res.status(400).json({ message: 'Storage key is required.' });
        }

        await streamPublicObject(res, key);
    } catch (error) {
        res.status(500).json({ message: 'Failed to load stored object.' });
    }
};

exports.downloadObject = async (req, res) => {
    try {
        const key = String(req.query.key || '').trim();
        const fileName = String(req.query.filename || '').trim();
        if (!key) {
            return res.status(400).json({ message: 'Storage key is required.' });
        }

        await sendDownload(res, key, fileName || undefined);
    } catch (error) {
        res.status(500).json({ message: 'Failed to download stored object.' });
    }
};
