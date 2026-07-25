const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
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
const { createAccountService } = require("../services/accountService");
const { createAccountRouter } = require("../routes/accountRouter");
const {
    createAccountEmailDelivery,
    resolveDefaultAccountProvider
} = require("../delivery/accountEmailDelivery");
const { createAuthRateLimiters } = require("../middleware/rateLimiter");
const { readSmtpConfig } = require("../config/smtpConfig");
const { allowedOrigins } = require("../config/corsOrigins");
const { createSessionService } = require("../services/sessionService");
const { createAuthSessionRouter } = require("../routes/authSessionRouter");

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
            const allowed = Boolean(isSameHost || configuredOrigins.includes(requestOrigin));

            // Stage 3B2: cookie-based auth endpoints (/api/auth/*) need the
            // browser to both send and read Set-Cookie on a cross-port local
            // dev origin (5173 -> 3001), which requires
            // Access-Control-Allow-Credentials: true. Only ever reflected
            // for a request whose Origin actually matched the allowlist/
            // same-host check above - never alongside a wildcard/unconditional
            // allow, which would be a real credential-leak vulnerability.
            callback(null, { origin: allowed, credentials: allowed });
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

// Both the invitation provider and the Stage 3B1 account-email provider
// speak to the exact same SMTP server (same INVITATION_EMAIL_PROVIDER=smtp
// opt-in switch, same SMTP_* env vars) - see delivery/accountEmailDelivery.js.
// Without this, defaultRouters() would independently resolve two SMTP
// providers, each constructing its own pooled Nodemailer transport to the
// same server, which invitationDeliveryComposition.test.js already treats as
// exactly the "one transport per router module" regression the composition
// root exists to prevent (see that file's own history/comment). Resolved
// once here, above both createDefaultStudioService/createDefaultAccountService,
// and threaded into both as an explicit transportFactory override -
// `transportFactory` from a caller (always a test) still wins outright, so
// the existing test-injection seam on both composition functions is
// unchanged. The transport itself is only ever built lazily, on whichever
// of the two providers is constructed first; the other reuses it.
function resolveSharedSmtpTransportFactory(env, { transportFactory } = {}) {
    if (transportFactory) return transportFactory;
    const config = readSmtpConfig(env);
    if (!config) return undefined;
    let cachedTransport;
    return (transportOptions) => {
        if (!cachedTransport) {
            // eslint-disable-next-line global-require -- lazy require keeps nodemailer out of any code path that never enables SMTP delivery
            const nodemailer = require("nodemailer");
            cachedTransport = nodemailer.createTransport(transportOptions);
        }
        return cachedTransport;
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

// Sibling composition root for Stage 3B1 account self-service e-mail
// (password change has no delivery dependency at all; only the e-mail
// change confirmation/notification path needs one). Deliberately its own
// function rather than folded into createDefaultStudioService: the two
// features share the same SMTP server configuration and opt-in switch
// (INVITATION_EMAIL_PROVIDER=smtp) but are otherwise independent delivery
// chains with different templates and base-URL contracts - see
// delivery/accountEmailDelivery.js.
function createDefaultAccountService({
    env = process.env,
    database = db.promise(),
    transportFactory,
    sessionService = createSessionService({ database })
} = {}) {
    const provider = resolveDefaultAccountProvider(env, { transportFactory });
    const delivery = createAccountEmailDelivery({ env, provider });
    return createAccountService({ database, delivery, sessionService });
}

function defaultRouters({ env, database = db.promise(), transportFactory } = {}) {
    const sharedTransportFactory = resolveSharedSmtpTransportFactory(env || process.env, { transportFactory });
    const studioService = createDefaultStudioService({ env, database, transportFactory: sharedTransportFactory });
    // One sessionService instance, shared between the account router
    // (password/e-mail change revocation, see accountService.js) and the
    // new /api/auth router (refresh/logout/logout-all) - both are stateless
    // wrappers around the same connection pool, so sharing costs nothing
    // and keeps this composition root's "build each dependency once" shape
    // consistent with sharedTransportFactory above.
    const sessionService = createSessionService({ database });
    const accountService = createDefaultAccountService({ env, database, transportFactory: sharedTransportFactory, sessionService });
    return {
        users: require("../routes/users"),
        exercises: require("../routes/exercises"),
        workouts: require("../routes/workouts"),
        progress: require("../routes/progress"),
        studioV1: createStudioV1Router({ service: studioService }),
        trainingProgramV1: createTrainingProgramV1Router({ studioService }),
        workoutSessionV1: createWorkoutSessionV1Router({ studioService }),
        account: createAccountRouter({
            service: accountService,
            rateLimiters: createAuthRateLimiters({ env })
        }),
        authSession: createAuthSessionRouter({ sessionService })
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
    app.use(cookieParser());
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
        if (routeSet.account) {
            app.use("/api/account", routeSet.account);
        }
        if (routeSet.authSession) {
            app.use("/api/auth", routeSet.authSession);
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
    createDefaultAccountService,
    createDefaultStudioService,
    createReadyHandler,
    defaultRouters,
    readTrustProxyHops,
    sendLive
};
