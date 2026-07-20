const express = require("express");
const cors = require("cors");
const {
    errorHandler: defaultErrorHandler,
    notFoundHandler: defaultNotFoundHandler,
    createRequestLoggingMiddleware,
    requestIdMiddleware,
    securityHeaders
} = require("../middleware/httpFoundation");
const db = require("../config/db");
const { createStudioService } = require("../services/studioService");
const { createInvitationOutbox } = require("../outbox/invitationOutbox");
const { createInvitationDelivery, resolveDefaultProvider } = require("../delivery/invitationDelivery");
const { createStudioV1Router } = require("../routes/studioV1");
const { createTrainingProgramV1Router } = require("../routes/trainingProgramV1");
const { createWorkoutSessionV1Router } = require("../routes/workoutSessionV1");

function allowedOrigins() {
    return (process.env.CORS_ORIGIN || "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
        .map((origin) => {
            let parsed;
            try {
                parsed = new URL(origin);
            } catch (cause) {
                const error = new Error("CORS_ORIGIN must contain valid absolute URLs.", { cause });
                error.code = "INVALID_CORS_CONFIG";
                throw error;
            }
            if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin) {
                const error = new Error("CORS_ORIGIN entries must be HTTP(S) origins without paths.");
                error.code = "INVALID_CORS_CONFIG";
                throw error;
            }
            return parsed.origin.toLowerCase();
        });
}

function readTrustProxyHops(env = process.env) {
    const value = env.TRUST_PROXY_HOPS;
    if (value === undefined || value === null || value === "") {
        return 0;
    }
    const hops = Number(value);
    if (!Number.isInteger(hops) || hops < 0 || hops > 10) {
        const error = new Error("TRUST_PROXY_HOPS must be an integer between 0 and 10.");
        error.code = "INVALID_PROXY_CONFIG";
        throw error;
    }
    return hops;
}

function createCorsOptions(configuredOrigins = allowedOrigins()) {
    return (req, callback) => {
        const origin = req.headers.origin;
        const requestOrigin = origin?.toLowerCase();
        const requestHost = req.headers.host?.toLowerCase();

        if (!requestOrigin) {
            callback(null, { origin: true });
            return;
        }

        try {
            const originHost = new URL(requestOrigin).host;
            const isSameHost = requestHost && originHost === requestHost;

            callback(null, {
                origin: Boolean(isSameHost || configuredOrigins.includes(requestOrigin))
            });
        } catch (error) {
            callback(error);
        }
    };
}

function sendLive(req, res) {
    res.set("Cache-Control", "no-store");
    res.status(200).json({ status: "live" });
}

function createReadyHandler(readiness, logger) {
    return async (req, res) => {
        res.set("Cache-Control", "no-store");

        try {
            const result = await readiness.check();
            if (!result.ready) {
                res.status(503).json({
                    status: "not_ready",
                    reason: result.reason || "unknown"
                });
                return;
            }

            res.status(200).json({ status: "ready" });
        } catch (error) {
            logger?.error("readiness_check_failed", { error });
            res.status(503).json({
                status: "not_ready",
                reason: "readiness_check_failed"
            });
        }
    };
}

// Explicit composition root for studio-tenant invitation delivery. Resolves
// the SMTP configuration/provider from environment exactly once, builds
// exactly one delivery/outbox/service chain from it, and every caller
// threads that same instance explicitly into whichever router needs a
// studio service - see the comment on resolveDefaultProvider() in
// delivery/invitationDelivery.js for why this replaced three independent,
// implicit per-router defaults. `env`/`database`/`transportFactory` are
// test-only overrides; the real server never passes them and gets the
// same behaviour as before (process.env, the real pool, real Nodemailer).
function createDefaultStudioService({ env = process.env, database = db.promise(), transportFactory } = {}) {
    const provider = resolveDefaultProvider(env, { transportFactory });
    const delivery = createInvitationDelivery({ env, provider });
    const outbox = createInvitationOutbox({ delivery });
    return createStudioService({ database, outbox });
}

function defaultRouters({ env, database, transportFactory } = {}) {
    const studioService = createDefaultStudioService({ env, database, transportFactory });
    return {
        users: require("../routes/users"),
        exercises: require("../routes/exercises"),
        workouts: require("../routes/workouts"),
        progress: require("../routes/progress"),
        studioV1: createStudioV1Router({ service: studioService }),
        trainingProgramV1: createTrainingProgramV1Router({ studioService }),
        workoutSessionV1: createWorkoutSessionV1Router({ studioService })
    };
}

function createApp({
    readiness,
    logger,
    includeRoutes = true,
    routers,
    beforeMiddleware,
    notFoundHandler,
    errorHandler
} = {}) {
    if (!readiness || typeof readiness.check !== "function") {
        throw new TypeError("createApp requires a readiness probe.");
    }

    const app = express();
    app.disable("x-powered-by");
    const trustProxyHops = readTrustProxyHops();
    if (trustProxyHops > 0) {
        app.set("trust proxy", trustProxyHops);
    }
    app.locals.logger = logger;
    app.use(requestIdMiddleware);
    app.use(createRequestLoggingMiddleware());
    app.use(securityHeaders);

    if (typeof beforeMiddleware === "function") {
        beforeMiddleware(app);
    }

    app.use(cors(createCorsOptions()));
    app.use(express.json({ limit: "1mb" }));

    const readyHandler = createReadyHandler(readiness, logger);
    app.get("/api/health/live", sendLive);
    app.get("/api/health/ready", readyHandler);
    app.get("/api/health", readyHandler);

    if (includeRoutes) {
        const routeSet = routers || defaultRouters();
        app.use("/api/users", routeSet.users);
        app.use("/api/exercises", routeSet.exercises);
        app.use("/api/workouts", routeSet.workouts);
        app.use("/api/progress", routeSet.progress);
        if (routeSet.studioV1) {
            app.use("/api/v1", routeSet.studioV1);
        }
        if (routeSet.trainingProgramV1) {
            app.use("/api/v1", routeSet.trainingProgramV1);
        }
        if (routeSet.workoutSessionV1) {
            app.use("/api/v1", routeSet.workoutSessionV1);
        }
    }

    app.use(
        notFoundHandler || defaultNotFoundHandler
    );

    app.use(
        errorHandler || defaultErrorHandler
    );

    return app;
}

module.exports = {
    allowedOrigins,
    createApp,
    createCorsOptions,
    createDefaultStudioService,
    createReadyHandler,
    defaultRouters,
    readTrustProxyHops,
    sendLive
};
