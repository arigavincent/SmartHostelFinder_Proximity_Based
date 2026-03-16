const MAX_IMPORT_ROWS = 1000;
const MAX_EXPORT_ROWS = 10000;

const parseCsv = (csvText) => {
    const lines = String(csvText || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    if (lines.length < 2) {
        return [];
    }

    const parseLine = (line) => {
        const values = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i += 1) {
            const char = line[i];
            const next = line[i + 1];

            if (char === '"' && inQuotes && next === '"') {
                current += '"';
                i += 1;
                continue;
            }

            if (char === '"') {
                inQuotes = !inQuotes;
                continue;
            }

            if (char === ',' && !inQuotes) {
                values.push(current);
                current = '';
                continue;
            }

            current += char;
        }

        values.push(current);
        return values.map((value) => value.trim());
    };

    const headers = parseLine(lines[0]).map((header) => header.toLowerCase());
    return lines.slice(1).map((line) => {
        const values = parseLine(line);
        return headers.reduce((record, header, index) => {
            record[header] = values[index] || '';
            return record;
        }, {});
    });
};

const toCsvValue = (value) => {
    const stringValue = String(value ?? '');
    return `"${stringValue.replace(/"/g, '""')}"`;
};

const determineCommissionRate = (hostelCount, config) => {
    const tier = config.tiers.find((item) => hostelCount >= item.minHostels && (item.maxHostels === null || hostelCount <= item.maxHostels));
    return tier ? Number(tier.rate) : Number(config.defaultRate);
};

module.exports = {
    MAX_IMPORT_ROWS,
    MAX_EXPORT_ROWS,
    parseCsv,
    toCsvValue,
    determineCommissionRate
};
