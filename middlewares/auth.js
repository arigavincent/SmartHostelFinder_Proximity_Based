const jwt = require('jsonwebtoken');

// Verify JWT Token
const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Access denied. No token provided.' });
    }
    
    const token = authHeader.split(' ')[1];
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
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

module.exports = { verifyToken, verifyAdmin, verifyOwner, verifyStudent, verifyOwnerOrAdmin };
