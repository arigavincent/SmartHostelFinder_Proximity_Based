const { sendEmailMessage } = require('./emailService');
const { buildExportCsv, importCsvData } = require('./bulkDataService');
const { generateObjectKey, getPrivateDownloadUrl, saveBuffer } = require('./storageService');

const runEmailJob = async (job) => {
    const { to, subject, html } = job.payload || {};
    if (!to || !subject || !html) {
        throw new Error('Email job payload is incomplete.');
    }

    await sendEmailMessage({ to, subject, html });
    return {
        deliveredTo: to,
        subject
    };
};

const runBulkImportJob = async (job) => {
    const { dataType, csvText } = job.payload || {};
    if (!dataType || !csvText) {
        throw new Error('Bulk import payload is incomplete.');
    }

    return importCsvData({ dataType, csvText });
};

const runBulkExportJob = async (job) => {
    const { exportType } = job.payload || {};
    if (!exportType) {
        throw new Error('Bulk export payload is incomplete.');
    }

    const { fileName, csv } = await buildExportCsv({ type: exportType });
    const key = generateObjectKey('private/exports', fileName);
    await saveBuffer({
        key,
        buffer: Buffer.from(csv, 'utf8'),
        contentType: 'text/csv'
    });

    return {
        fileName,
        exportType,
        storageKey: key,
        downloadUrl: await getPrivateDownloadUrl(key, fileName)
    };
};

module.exports = {
    email: runEmailJob,
    bulk_import: runBulkImportJob,
    bulk_export: runBulkExportJob
};
