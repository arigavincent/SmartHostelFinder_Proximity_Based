/**
 * Validation Helper
 * Validates input fields for authentication
 */

// Email validation regex
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Password requirements: min 6 chars, at least 1 letter and 1 number
const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*#?&]{6,}$/;

// Username/Full name: letters, spaces, 3-50 chars
const usernameRegex = /^[a-zA-Z][a-zA-Z\s]{1,48}[a-zA-Z]$/;

/**
 * Validate student registration fields
 */
const validateStudentRegistration = (data) => {
    const errors = [];
    
    if (!data.username || data.username.trim() === '') {
        errors.push('Full name is required.');
    } else if (data.username.trim().length < 3) {
        errors.push('Full name must be at least 3 characters.');
    } else if (data.username.trim().length > 50) {
        errors.push('Full name must not exceed 50 characters.');
    }
    
    if (!data.email || data.email.trim() === '') {
        errors.push('Email is required.');
    } else if (!emailRegex.test(data.email)) {
        errors.push('Please provide a valid email address.');
    }
    
    if (!data.password) {
        errors.push('Password is required.');
    } else if (data.password.length < 6) {
        errors.push('Password must be at least 6 characters.');
    } else if (!passwordRegex.test(data.password)) {
        errors.push('Password must contain at least one letter and one number.');
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
};

/**
 * Validate owner registration fields
 */
const validateOwnerRegistration = (data, hasLicense = false) => {
    const errors = [];
    
    if (!data.username || data.username.trim() === '') {
        errors.push('Full name is required.');
    } else if (data.username.trim().length < 3 || data.username.trim().length > 50) {
        errors.push('Full name must be 3-50 characters.');
    } else if (!/^[a-zA-Z][a-zA-Z\s]*[a-zA-Z]$/.test(data.username.trim())) {
        errors.push('Full name must contain only letters and spaces.');
    }
    
    if (!data.email || data.email.trim() === '') {
        errors.push('Email is required.');
    } else if (!emailRegex.test(data.email)) {
        errors.push('Please provide a valid email address.');
    }
    
    if (!data.password) {
        errors.push('Password is required.');
    } else if (data.password.length < 6) {
        errors.push('Password must be at least 6 characters.');
    } else if (!passwordRegex.test(data.password)) {
        errors.push('Password must contain at least one letter and one number.');
    }
    
    if (!hasLicense) {
        errors.push('Business permit/license is required.');
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
};

/**
 * Validate admin creation fields
 */
const validateAdminCreation = (data) => {
    const errors = [];
    
    if (!data.username || data.username.trim() === '') {
        errors.push('Full name is required.');
    } else if (data.username.trim().length < 3 || data.username.trim().length > 50) {
        errors.push('Full name must be 3-50 characters.');
    } else if (!/^[a-zA-Z][a-zA-Z\s]*[a-zA-Z]$/.test(data.username.trim())) {
        errors.push('Full name must contain only letters and spaces.');
    }
    
    if (!data.email || data.email.trim() === '') {
        errors.push('Email is required.');
    } else if (!emailRegex.test(data.email)) {
        errors.push('Please provide a valid email address.');
    }
    
    if (!data.password) {
        errors.push('Password is required.');
    } else if (data.password.length < 6) {
        errors.push('Password must be at least 6 characters.');
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
};

/**
 * Validate login fields
 */
const validateLogin = (data) => {
    const errors = [];
    
    if (!data.email && !data.username) {
        errors.push('Email or username is required.');
    }
    
    if (data.email && !emailRegex.test(data.email)) {
        errors.push('Please provide a valid email address.');
    }
    
    if (!data.password) {
        errors.push('Password is required.');
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
};

/**
 * Validate password reset fields
 */
const validatePasswordReset = (data) => {
    const errors = [];
    
    if (!data.token) {
        errors.push('Reset token is required.');
    }
    
    if (!data.password) {
        errors.push('New password is required.');
    } else if (data.password.length < 6) {
        errors.push('Password must be at least 6 characters.');
    } else if (!passwordRegex.test(data.password)) {
        errors.push('Password must contain at least one letter and one number.');
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
};

/**
 * Validate email field
 */
const validateEmail = (email) => {
    if (!email || email.trim() === '') {
        return { isValid: false, error: 'Email is required.' };
    }
    if (!emailRegex.test(email)) {
        return { isValid: false, error: 'Please provide a valid email address.' };
    }
    return { isValid: true };
};

module.exports = {
    validateStudentRegistration,
    validateOwnerRegistration,
    validateAdminCreation,
    validateLogin,
    validatePasswordReset,
    validateEmail
};
