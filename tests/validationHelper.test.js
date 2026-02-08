const test = require('node:test');
const assert = require('node:assert/strict');

const {
    validateStudentRegistration,
    validateOwnerRegistration,
    validatePasswordReset,
    validateEmail
} = require('../helpers/validationHelper');

test('validateStudentRegistration accepts valid payload', () => {
    const result = validateStudentRegistration({
        username: 'John Doe',
        email: 'john@example.com',
        password: 'abc123'
    });

    assert.equal(result.isValid, true);
    assert.deepEqual(result.errors, []);
});

test('validateOwnerRegistration requires license file', () => {
    const result = validateOwnerRegistration({
        username: 'Owner Name',
        email: 'owner@example.com',
        password: 'abc123'
    }, false);

    assert.equal(result.isValid, false);
    assert.ok(result.errors.includes('Business permit/license is required.'));
});

test('validatePasswordReset rejects weak password', () => {
    const result = validatePasswordReset({
        token: 'sometoken',
        password: 'abcdef'
    });

    assert.equal(result.isValid, false);
    assert.ok(result.errors.includes('Password must contain at least one letter and one number.'));
});

test('validateEmail rejects malformed addresses', () => {
    const result = validateEmail('not-an-email');
    assert.equal(result.isValid, false);
    assert.equal(result.error, 'Please provide a valid email address.');
});
