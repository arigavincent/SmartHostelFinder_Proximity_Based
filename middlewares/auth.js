const jwt = require('jsonwebtoken');
const Owner = require('../models/Owners');

// Verify JWT Token
const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Access denied. No token provided.' });
    }
    
    const token = authHeader.split(' ')[1];
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (decoded.role === 'owner') {
            const owner = await Owner.findById(decoded.id).select('isSuspended');
            if (!owner) {
                return res.status(404).json({ message: 'Owner account not found.' });
            }

            if (owner.isSuspended) {
                return res.status(403).json({ message: 'Owner account is suspended.' });
            }
        }

        req.user = decoded;
        next();
    } catch (error) {
        return res.status(403).json({ message: 'Invalid or expired token.' });
    }
};

// Verify Admin
const verifyAdmin = (req, res, next) => {
    verifyToken(req, res, () => {
        if (req.user.role === 'admin') {
            next();
        } else {
            return res.status(403).json({ message: 'Admin access required.' });
        }
    });
};

// Verify Owner
const verifyOwner = (req, res, next) => {
    verifyToken(req, res, () => {
        if (req.user.role === 'owner') {
            next();
        } else {
            return res.status(403).json({ message: 'Owner access required.' });
        }
    });
};

// Verify Student
const verifyStudent = (req, res, next) => {
    verifyToken(req, res, () => {
        if (req.user.role === 'student') {
            next();
        } else {
            return res.status(403).json({ message: 'Student access required.' });
        }
    });
};

// Verify Owner or Admin
const verifyOwnerOrAdmin = (req, res, next) => {
    verifyToken(req, res, () => {
        if (req.user.role === 'owner' || req.user.role === 'admin') {
            next();
        } else {
            return res.status(403).json({ message: 'Owner or Admin access required.' });
        }
    });
};

const optionalToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next();
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (decoded.role === 'owner') {
            const owner = await Owner.findById(decoded.id).select('isSuspended');
            if (!owner || owner.isSuspended) {
                return next();
            }
        }

        req.user = decoded;
    } catch (error) {
        // Treat invalid optional auth as anonymous for public routes.
    }

    next();
};

module.exports = { verifyToken, verifyAdmin, verifyOwner, verifyStudent, verifyOwnerOrAdmin, optionalToken };
