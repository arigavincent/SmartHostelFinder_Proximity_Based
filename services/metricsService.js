const os = require('os');

const httpRequestCounters = new Map();
const httpRequestDurations = new Map();
const jobCounters = new Map();
let alertsSent = 0;

const incrementMap = (map, key, value = 1) => {
    map.set(key, (map.get(key) || 0) + value);
};

const escapeLabel = (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const recordHttpRequest = ({ method, route, statusCode, durationMs }) => {
    const counterKey = `${method}|${route}|${statusCode}`;
    incrementMap(httpRequestCounters, counterKey);
    incrementMap(httpRequestDurations, counterKey, durationMs);
};

const recordJobStatus = ({ type, status }) => {
    incrementMap(jobCounters, `${type}|${status}`);
};

const recordAlertSent = () => {
    alertsSent += 1;
};

const renderPrometheusMetrics = async ({ BackgroundJob } = {}) => {
    const lines = [];

    lines.push('# HELP app_http_requests_total Total number of HTTP requests handled.');
    lines.push('# TYPE app_http_requests_total counter');
    for (const [key, value] of httpRequestCounters.entries()) {
        const [method, route, statusCode] = key.split('|');
        lines.push(`app_http_requests_total{method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${escapeLabel(statusCode)}"} ${value}`);
    }

    lines.push('# HELP app_http_request_duration_ms_total Total HTTP request duration in milliseconds.');
    lines.push('# TYPE app_http_request_duration_ms_total counter');
    for (const [key, value] of httpRequestDurations.entries()) {
        const [method, route, statusCode] = key.split('|');
        lines.push(`app_http_request_duration_ms_total{method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${escapeLabel(statusCode)}"} ${value.toFixed(2)}`);
    }

    lines.push('# HELP app_background_jobs_total Background job transitions by type and status.');
    lines.push('# TYPE app_background_jobs_total counter');
    for (const [key, value] of jobCounters.entries()) {
        const [type, status] = key.split('|');
        lines.push(`app_background_jobs_total{type="${escapeLabel(type)}",status="${escapeLabel(status)}"} ${value}`);
    }

    if (BackgroundJob) {
        const summary = await BackgroundJob.aggregate([
            {
                $group: {
                    _id: '$status',
                    total: { $sum: 1 }
                }
            }
        ]);

        lines.push('# HELP app_background_jobs_pending Current background jobs by status.');
        lines.push('# TYPE app_background_jobs_pending gauge');
        summary.forEach((item) => {
            lines.push(`app_background_jobs_pending{status="${escapeLabel(item._id)}"} ${item.total}`);
        });
    }

    lines.push('# HELP app_alerts_sent_total Total alerts successfully sent.');
    lines.push('# TYPE app_alerts_sent_total counter');
    lines.push(`app_alerts_sent_total ${alertsSent}`);

    lines.push('# HELP process_uptime_seconds Process uptime in seconds.');
    lines.push('# TYPE process_uptime_seconds gauge');
    lines.push(`process_uptime_seconds ${process.uptime().toFixed(2)}`);

    lines.push('# HELP process_resident_memory_bytes Resident set size memory usage.');
    lines.push('# TYPE process_resident_memory_bytes gauge');
    lines.push(`process_resident_memory_bytes ${process.memoryUsage().rss}`);

    lines.push('# HELP process_cpu_count Number of CPU cores available.');
    lines.push('# TYPE process_cpu_count gauge');
    lines.push(`process_cpu_count ${os.cpus().length}`);

    return `${lines.join('\n')}\n`;
};

const metricsMiddleware = (req, res, next) => {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
        const route = req.route?.path
            ? `${req.baseUrl || ''}${req.route.path}`
            : req.originalUrl?.split('?')[0] || 'unmatched';

        recordHttpRequest({
            method: req.method,
            route,
            statusCode: res.statusCode,
            durationMs
        });
    });

    next();
};

module.exports = {
    metricsMiddleware,
    recordJobStatus,
    recordAlertSent,
    renderPrometheusMetrics
};
