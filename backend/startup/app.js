const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const {
    errorHandler: defaultErrorHandler,
    notFoundHandler: defaultNotFoundHandler,
    createJsonContentTypeGuard,
    createRequestLoggingMiddleware,
    createSecurityHeaders,
    requestIdMiddleware
} = require("../middleware/httpFoundation");
const { readRequestLimitsConfig } = require("../config/requestLimitsConfig");
const db = require("../config/db");
const { createStudioService } = require("../services/studioService");
const { createInvitationOutbox } = require("../outbox/invitationOutbox");
const { createInvitationDelivery, resolveDefaultProvider } = require("../delivery/invitationDelivery");
const { createStudioV1Router } = require("../routes/studioV1");
const { createTrainingProgramV1Router } = require("../routes/trainingProgramV1");
const { createWorkoutSessionV1Router } = require("../routes/workoutSessionV1");
const { createTrainingCalendarV1Router } = require("../routes/trainingCalendarV1");
const { createAssignmentScheduleRuleV1Router } = require("../routes/assignmentScheduleRuleV1");
const { createTrainingCalendarService } = require("../services/trainingCalendarService");
const { createScheduleRuleService } = require("../services/scheduleRuleService");
const { createAccountService } = require("../services/accountService");
const { createAccountDeletionService } = require("../services/accountDeletionService");
const { createAccountRouter } = require("../routes/accountRouter");
const {
    createAccountEmailDelivery,
    resolveDefaultAccountProvider
} = require("../delivery/accountEmailDelivery");
const { createRateLimiters } = require("../middleware/rateLimiter");
const { createMySqlRateLimitStore } = require("../rateLimiting/mysqlRateLimitStore");
const { readSmtpConfig } = require("../config/smtpConfig");
const { readCorsConfig } = require("../config/corsOrigins");
const { readProxyConfig } = require("../config/proxyConfig");
const { createSessionService } = require("../services/sessionService");
const { createAuthSessionRouter } = require("../routes/authSessionRouter");

// Minimal, explicit allow-lists (Section 13) rather than reflecting
// whatever a preflight requests: every method and header this API's routes
// actually use, and nothing else. `cors` handles OPTIONS itself
// (preflightContinue defaults to false), so it does not need to appear here.
const CORS_ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const CORS_ALLOWED_HEADERS = ["Content-Type", "Authorization", "X-CSRF-Token"];
// Response headers a browser's JS may read cross-origin: the rate-limit
// bookkeeping headers (for the frontend's Retry-After countdown UX) and the
// request id (for user-facing error reporting) - see middleware/rateLimiter.js
// and middleware/httpFoundation.js respectively.
const CORS_EXPOSED_HEADERS = ["RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset", "Retry-After", "X-Request-ID"];

function createCorsOptions(corsConfig = readCorsConfig()) {
    const { allowedOrigins, allowCredentials, maxAgeSeconds } = corsConfig;
    return (req, callback) => {
        const origin = req.headers.origin;
        const requestOrigin = origin?.toLowerCase();
        const requestHost = req.headers.host?.toLowerCase();

        if (!requestOrigin) {
            callback(null, {
                origin: true,
                methods: CORS_ALLOWED_METHODS,
                allowedHeaders: CORS_ALLOWED_HEADERS,
                exposedHeaders: CORS_EXPOSED_HEADERS,
                maxAge: maxAgeSeconds
            });
            return;
        }

        try {
            const originHost = new URL(requestOrigin).host;
            const isSameHost = requestHost && originHost === requestHost;
            // Exact membership only - never a substring/suffix/prefix
            // match, so "https://example.com.evil.test" can never be
            // confused with an allowed "https://example.com".
            const allowed = Boolean(isSameHost || allowedOrigins.includes(requestOrigin));

            // Stage 3B2: cookie-based auth endpoints (/api/auth/*) need the
            // browser to both send and read Set-Cookie on a cross-port local
            // dev origin (5173 -> 3001), which requires
            // Access-Control-Allow-Credentials: true. Only ever reflected
            // for a request whose Origin actually matched the allowlist/
            // same-host check above, and only when CORS_ALLOW_CREDENTIALS
            // permits it - never alongside a wildcard/unconditional allow,
            // which would be a real credential-leak vulnerability. A
            // rejected origin gets `origin: false`, which makes the `cors`
            // package omit every Access-Control-* header entirely (no
            // permissive header of any kind leaks to a disallowed origin).
            callback(null, {
                origin: allowed,
                credentials: allowed && allowCredentials,
                methods: CORS_ALLOWED_METHODS,
                allowedHeaders: CORS_ALLOWED_HEADERS,
                exposedHeaders: CORS_EXPOSED_HEADERS,
                maxAge: maxAgeSeconds
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

// One MySqlRateLimitStore, one createRateLimiters() call, shared by every
// router below - all backed by the exact same `database` this composition
// root was given (the real pool in production, an explicit test pool in
// integration tests). See middleware/rateLimiter.js and
// rateLimiting/mysqlRateLimitStore.js: there is deliberately no in-memory
// fallback anywhere in this path (Section 5/10).
function createDefaultRateLimiters({ env, database }) {
    const store = createMySqlRateLimitStore({ database });
    return createRateLimiters({ store, env });
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
    const accountDeletionService = createAccountDeletionService({ database, sessionService });
    const rateLimiters = createDefaultRateLimiters({ env, database });
    return {
        users: require("../routes/users"),
        exercises: require("../routes/exercises"),
        workouts: require("../routes/workouts"),
        progress: require("../routes/progress"),
        studioV1: createStudioV1Router({
            service: studioService,
            rateLimiters: {
                create: rateLimiters.invitationCreate,
                resend: rateLimiters.invitationResend,
                accept: rateLimiters.invitationAccept
            }
        }),
        trainingProgramV1: createTrainingProgramV1Router({ studioService }),
        workoutSessionV1: createWorkoutSessionV1Router({ studioService }),
        trainingCalendarV1: createTrainingCalendarV1Router({
            service: createTrainingCalendarService({ database })
        }),
        assignmentScheduleRuleV1: createAssignmentScheduleRuleV1Router({
            studioService,
            scheduleRuleService: createScheduleRuleService({ database })
        }),
        account: createAccountRouter({
            service: accountService,
            deletionService: accountDeletionService,
            rateLimiters: {
                passwordChange: rateLimiters.passwordChange,
                emailChangeRequest: rateLimiters.emailChangeRequest,
                emailChangeConfirm: rateLimiters.emailChangeConfirm,
                deleteRequest: rateLimiters.deleteRequest
            }
        }),
        authSession: createAuthSessionRouter({
            sessionService,
            rateLimiters: {
                refresh: rateLimiters.refresh,
                logoutAll: rateLimiters.logoutAll
            }
        })
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
    const proxyConfig = readProxyConfig();
    if (proxyConfig.mode === "hops") {
        // Always a specific integer hop count - never `app.set('trust
        // proxy', true)`, which would trust an unbounded chain and let a
        // client's own X-Forwarded-For prefix be believed.
        app.set("trust proxy", proxyConfig.hops);
    }
    app.locals.logger = logger;
    app.use(requestIdMiddleware);
    app.use(createRequestLoggingMiddleware());
    app.use(createSecurityHeaders());

    if (typeof beforeMiddleware === "function") {
        beforeMiddleware(app);
    }

    app.use(cors(createCorsOptions()));
    app.use(cookieParser());
    app.use(createJsonContentTypeGuard());
    app.use(express.json({ limit: readRequestLimitsConfig().jsonLimit }));

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
        if (routeSet.trainingCalendarV1) {
            app.use("/api/v1", routeSet.trainingCalendarV1);
        }
        if (routeSet.assignmentScheduleRuleV1) {
            app.use("/api/v1", routeSet.assignmentScheduleRuleV1);
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
    createApp,
    createCorsOptions,
    createDefaultAccountService,
    createDefaultStudioService,
    createReadyHandler,
    defaultRouters,
    sendLive
};
