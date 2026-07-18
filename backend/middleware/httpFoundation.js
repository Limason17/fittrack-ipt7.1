const { randomUUID } = require("node:crypto");
const { AppError, NotFoundError } = require("../errors/AppError");

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

function requestIdMiddleware(req, res, next) {
    const incomingId = req.headers?.["x-request-id"];
    req.requestId = typeof incomingId === "string" && REQUEST_ID_PATTERN.test(incomingId)
        ? incomingId
        : randomUUID();
    res.setHeader("X-Request-ID", req.requestId);
    next();
}

function securityHeaders(req, res, next) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    );
    next();
}

function requestRoute(req) {
    const routePath = typeof req.route?.path === "string" ? req.route.path : null;
    if (routePath) {
        const suffix = routePath === "/" ? "" : routePath;
        const joined = `${req.baseUrl || ""}${suffix}` || "/";
        return joined.replace(/\/{2,}/g, "/");
    }
    return req.path || String(req.originalUrl || "/").split("?", 1)[0] || "/";
}

function createRequestLoggingMiddleware({ now = () => Number(process.hrtime.bigint()) / 1e6 } = {}) {
    return function requestLoggingMiddleware(req, res, next) {
        const startedAt = now();
        res.once("finish", () => {
            const logger = req.app?.locals?.logger;
            logger?.info?.("api_request_completed", {
                requestId: req.requestId,
                method: req.method,
                route: requestRoute(req),
                status: res.statusCode,
                durationMs: Math.round((now() - startedAt) * 100) / 100
            });
        });
        next();
    };
}

function notFoundHandler(req, res, next) {
    next(new NotFoundError("Route not found."));
}

function errorHandler(error, req, res, next) { // eslint-disable-line no-unused-vars
    let normalizedError = error;
    if (!(error instanceof AppError) && error?.type === "entity.parse.failed") {
        normalizedError = new AppError({
            status: 400,
            code: "INVALID_JSON",
            message: "The request body must contain valid JSON."
        });
    } else if (!(error instanceof AppError) && error?.type === "entity.too.large") {
        normalizedError = new AppError({
            status: 413,
            code: "PAYLOAD_TOO_LARGE",
            message: "The request body exceeds the allowed size."
        });
    }

    const knownError = normalizedError instanceof AppError;
    const status = knownError ? normalizedError.status : 500;
    const code = knownError ? normalizedError.code : "INTERNAL_ERROR";
    const message = knownError && normalizedError.expose
        ? normalizedError.message
        : "An unexpected error occurred.";
    const logger = req.app?.locals?.logger || console;

    const logFields = {
        requestId: req.requestId,
        method: req.method,
        route: requestRoute(req),
        status,
        code,
        errorName: error?.name || "Error"
    };
    if (status >= 500) {
        logFields.error = normalizedError;
    }
    const logMethod = status >= 500
        ? logger.error
        : (logger.warn || logger.info || logger.error);
    logMethod?.call(logger, status >= 500 ? "api_request_failed" : "api_request_rejected", logFields);

    const responseError = {
        code,
        message,
        requestId: req.requestId
    };

    if (knownError && normalizedError.fields) {
        responseError.fields = normalizedError.fields;
    }

    res.status(status).json({ error: responseError });
}

module.exports = {
    createRequestLoggingMiddleware,
    errorHandler,
    notFoundHandler,
    requestRoute,
    requestIdMiddleware,
    securityHeaders
};
