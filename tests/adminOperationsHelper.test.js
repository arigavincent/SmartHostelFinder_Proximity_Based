const test = require('node:test');
const assert = require('node:assert/strict');

const {
    MAX_IMPORT_ROWS,
    MAX_EXPORT_ROWS,
    parseCsv,
    toCsvValue,
    determineCommissionRate
} = require('../helpers/adminOperationsHelper');

test('parseCsv handles quoted fields and header normalization', () => {
    const rows = parseCsv('Name,OwnerEmail,Description\n"Alpha Hostel",owner@example.com,"Large, furnished rooms"\n');

    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Alpha Hostel');
    assert.equal(rows[0].owneremail, 'owner@example.com');
    assert.equal(rows[0].description, 'Large, furnished rooms');
});

test('toCsvValue escapes quotes and wraps output', () => {
    assert.equal(toCsvValue('hello "world"'), '"hello ""world"""');
    assert.equal(toCsvValue(null), '""');
});

test('determineCommissionRate selects matching tier or falls back to default', () => {
    const config = {
        defaultRate: 12,
        tiers: [
            { minHostels: 1, maxHostels: 5, rate: 10 },
            { minHostels: 6, maxHostels: 15, rate: 8 },
            { minHostels: 16, maxHostels: null, rate: 6 }
        ]
    };

    assert.equal(determineCommissionRate(3, config), 10);
    assert.equal(determineCommissionRate(12, config), 8);
    assert.equal(determineCommissionRate(24, config), 6);
    assert.equal(determineCommissionRate(0, config), 12);
});

test('admin operation limits stay within intended bounds', () => {
    assert.equal(MAX_IMPORT_ROWS, 1000);
    assert.equal(MAX_EXPORT_ROWS, 10000);
});
