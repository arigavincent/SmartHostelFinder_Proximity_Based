const test = require('node:test');
const assert = require('node:assert/strict');

const { generateToken, hashToken } = require('../helpers/tokenHelper');

test('generateToken returns a 64-char hex token', () => {
    const token = generateToken();
    assert.match(token, /^[a-f0-9]{64}$/);
});

test('hashToken is deterministic and does not equal plain token', () => {
    const token = generateToken();
    const firstHash = hashToken(token);
    const secondHash = hashToken(token);

    assert.equal(firstHash, secondHash);
    assert.notEqual(firstHash, token);
    assert.match(firstHash, /^[a-f0-9]{64}$/);
});
