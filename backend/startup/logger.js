const REDACTED = "[REDACTED]";
const SENSITIVE_KEY_PATTERN = /password|passphrase|secret|token|authorization|cookie|credential|jwt|refresh/i;

function redactString(value) {
    return String(value)
        .replace(
            /((?:password|passphrase|secret|token|authorization|cookie|credential|jwt|refresh)\s*[=:]\s*)[^\s,;]+/gi,
            `$1${REDACTED}`
        )
        .replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${REDACTED}`)
        .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED)
        .replace(/:\/\/[^/@\s]+@/g, `://${REDACTED}@`);
}

function sanitize(value, seen = new WeakSet()) {
    if (value === null || value === undefined) {
        return value;
    }

    if (typeof value === "string") {
        return redactString(value);
    }

    if (typeof value !== "object") {
        return value;
    }

    if (value instanceof Error) {
        if (seen.has(value)) {
            return "[Circular]";
        }
        seen.add(value);
        return {
            name: value.name,
            code: value.code || undefined,
            message: redactString(value.message),
            stack: value.stack ? redactString(value.stack) : undefined,
            cause: value.cause ? sanitize(value.cause, seen) : undefined
        };
    }

    if (seen.has(value)) {
        return "[Circular]";
    }
    seen.add(value);

    if (Array.isArray(value)) {
        return value.map((item) => sanitize(item, seen));
    }

    return Object.fromEntries(
        Object.entries(value).map(([key, entryValue]) => [
            key,
            SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : sanitize(entryValue, seen)
        ])
    );
}

function createStructuredLogger(output = console) {
    function write(level, event, fields = {}) {
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            event,
            ...sanitize(fields)
        };
        const line = JSON.stringify(entry);
        const method = level === "error" ? "error" : level === "warn" ? "warn" : "log";
        output[method](line);
    }

    return {
        info(event, fields) {
            write("info", event, fields);
        },
        warn(event, fields) {
            write("warn", event, fields);
        },
        error(event, fields) {
            write("error", event, fields);
        }
    };
}

module.exports = {
    createStructuredLogger,
    sanitize
};
