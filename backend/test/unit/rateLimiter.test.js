const test = require("node:test");
const assert = require("node:assert/strict");

const { createRateLimitMiddleware, createRateLimiters } = require("../../middleware/rateLimiter");
const { createMemoryRateLimitStore } = require("../../rateLimiting/memoryRateLimitStore");
const { createRateLimitPolicies } = require("../../rateLimiting/rateLimitPolicies");
const {
    errorHandler,
    requestIdMiddleware
} = require("../../middleware/httpFoundation");

const TEST_SECRET = "unit-test-rate-limit-key-secret-32-bytes-minimum";

function request(overrides = {}) {
    return {
        ip: "127.0.0.1",
        socket: { remoteAddress: "127.0.0.1" },
        body: {},
        params: {},
        headers: {},
        ...overrides
    };
}

test("createRateLimiters requires an explicit store - there is no parameterless default", () => {
    assert.throws(() => createRateLimiters({}), TypeError);
    assert.throws(() => createRateLimiters(), TypeError);
});

test("the middleware allows the configured number and rejects the next request", async () => {
    let time = 1000;
    const policies = createRateLimitPolicies({
        env: { AUTH_LOGIN_RATE_LIMIT_MAX: "2", AUTH_LOGIN_RATE_LIMIT_WINDOW_MS: "60000" }
    });
    const middleware = createRateLimitMiddleware({
        policy: policies["auth.login"],
        store: createMemoryRateLimitStore(),
        keySecret: TEST_SECRET,
        now: () => time
    });
    const res = { setHeader() {} };
    const outcomes = [];
    const req = request({ body: { email: "user@example.test" } });

    await middleware(req, res, (error) => outcomes.push(error || null));
    await middleware(req, res, (error) => outcomes.push(error || null));
    await middleware(req, res, (error) => outcomes.push(error || null));

    assert.equal(outcomes[0], null);
    assert.equal(outcomes[1], null);
    assert.equal(outcomes[2].status, 429);
    assert.equal(outcomes[2].code, "RATE_LIMIT_EXCEEDED");

    time += 60_001;
    await middleware(req, res, (error) => outcomes.push(error || null));
    assert.equal(outcomes[3], null, "a new window must allow the request again");
});

test("login and registration policies are independent and different clients do not block each other", async () => {
    const store = createMemoryRateLimitStore();
    const { login, registration } = createRateLimiters({
        store,
        keySecret: TEST_SECRET,
        now: () => 1000,
        policies: createRateLimitPolicies({
            env: {
                AUTH_LOGIN_RATE_LIMIT_MAX: "1",
                AUTH_REGISTRATION_RATE_LIMIT_MAX: "1",
                AUTH_LOGIN_RATE_LIMIT_WINDOW_MS: "60000",
                AUTH_REGISTRATION_RATE_LIMIT_WINDOW_MS: "60000"
            }
        })
    });
    const headers = {};
    const res = { setHeader(name, value) { headers[name] = value; } };
    const outcomes = [];

    await registration(request({ ip: "client-a" }), res, (error) => outcomes.push(error || null));
    await registration(request({ ip: "client-a" }), res, (error) => outcomes.push(error || null));
    await login(request({ ip: "client-a", body: { email: "a@example.test" } }), res, (error) => outcomes.push(error || null));
    await registration(request({ ip: "client-b" }), res, (error) => outcomes.push(error || null));

    assert.equal(outcomes[0], null);
    assert.equal(outcomes[1].status, 429);
    assert.equal(outcomes[2], null, "login limiter must not share registration state");
    assert.equal(outcomes[3], null, "another client key must remain available");
    assert.equal(headers["Retry-After"], "60");
    assert.equal(headers["RateLimit-Remaining"], "0");
});

test("Stage 3D/5C1: all eleven policies exist, are independent, and read env overrides with sane defaults", async () => {
    const store = createMemoryRateLimitStore();
    const limiters = createRateLimiters({
        store,
        keySecret: TEST_SECRET,
        now: () => 1000,
        policies: createRateLimitPolicies({
            env: { AUTH_PASSWORD_CHANGE_RATE_LIMIT_MAX: "1", AUTH_EMAIL_CHANGE_RATE_LIMIT_MAX: "1", AUTH_EMAIL_CHANGE_CONFIRM_RATE_LIMIT_MAX: "1" }
        })
    });
    for (const name of [
        "login", "registration", "refresh", "logoutAll", "passwordChange",
        "emailChangeRequest", "emailChangeConfirm", "invitationCreate", "invitationResend", "invitationAccept",
        "deleteRequest"
    ]) {
        assert.equal(typeof limiters[name], "function", `expected a ${name} middleware`);
    }

    const res = { setHeader() {} };
    const outcomes = [];
    const req = request({ user: { id: 7 } });
    await limiters.passwordChange(req, res, (error) => outcomes.push(error || null));
    await limiters.passwordChange(req, res, (error) => outcomes.push(error || null));
    await limiters.emailChangeRequest(req, res, (error) => outcomes.push(error || null));
    await limiters.emailChangeConfirm(request(), res, (error) => outcomes.push(error || null));

    assert.equal(outcomes[0], null);
    assert.equal(outcomes[1].status, 429);
    assert.equal(outcomes[2], null, "emailChangeRequest must not share passwordChange state");
    assert.equal(outcomes[3], null, "emailChangeConfirm must not share passwordChange state");
});

test("account rate limiter env var overrides are honoured", async () => {
    const store = createMemoryRateLimitStore();
    const limiters = createRateLimiters({
        store,
        keySecret: TEST_SECRET,
        now: () => 1000,
        policies: createRateLimitPolicies({
            env: { AUTH_PASSWORD_CHANGE_RATE_LIMIT_MAX: "2" }
        })
    });
    const res = { setHeader() {} };
    const outcomes = [];
    const req = request({ user: { id: 1 } });
    await limiters.passwordChange(req, res, (error) => outcomes.push(error || null));
    await limiters.passwordChange(req, res, (error) => outcomes.push(error || null));
    await limiters.passwordChange(req, res, (error) => outcomes.push(error || null));
    assert.equal(outcomes[0], null);
    assert.equal(outcomes[1], null);
    assert.equal(outcomes[2].status, 429);
});

test("Stage 5C1: account.deleteRequest defaults to 3/60min, is keyed per user, and is independent from passwordChange", async () => {
    const store = createMemoryRateLimitStore();
    const policies = createRateLimitPolicies({ env: {} });
    assert.equal(policies["account.deleteRequest"].max, 3);
    assert.equal(policies["account.deleteRequest"].windowMs, 60 * 60 * 1000);

    const limiters = createRateLimiters({
        store,
        keySecret: TEST_SECRET,
        now: () => 1000,
        policies: createRateLimitPolicies({ env: { ACCOUNT_DELETE_RATE_LIMIT_MAX: "2" } })
    });
    const res = { setHeader() {} };
    const outcomes = [];
    const req = request({ user: { id: 9 } });
    await limiters.deleteRequest(req, res, (error) => outcomes.push(error || null));
    await limiters.deleteRequest(req, res, (error) => outcomes.push(error || null));
    await limiters.deleteRequest(req, res, (error) => outcomes.push(error || null));
    await limiters.passwordChange(req, res, (error) => outcomes.push(error || null));

    assert.equal(outcomes[0], null);
    assert.equal(outcomes[1], null);
    assert.equal(outcomes[2].status, 429);
    assert.equal(outcomes[2].code, "RATE_LIMIT_EXCEEDED");
    assert.equal(outcomes[3], null, "passwordChange must not share deleteRequest state");
});

test("invitation resend limiter is keyed per actor+invitation and reports the dedicated error code", async () => {
    const store = createMemoryRateLimitStore();
    const { invitationResend } = createRateLimiters({
        store,
        keySecret: TEST_SECRET,
        now: () => 1000,
        policies: createRateLimitPolicies({
            env: { INVITATION_RESEND_RATE_LIMIT_MAX: "2" }
        })
    });
    const res = { setHeader() {} };
    const outcomes = [];
    const reqFor = (userId, invitationId) => request({ user: { id: userId }, params: { invitationId } });

    await invitationResend(reqFor(1, "inv-a"), res, (error) => outcomes.push(error || null));
    await invitationResend(reqFor(1, "inv-a"), res, (error) => outcomes.push(error || null));
    await invitationResend(reqFor(1, "inv-a"), res, (error) => outcomes.push(error || null));
    await invitationResend(reqFor(1, "inv-b"), res, (error) => outcomes.push(error || null));
    await invitationResend(reqFor(2, "inv-a"), res, (error) => outcomes.push(error || null));

    assert.equal(outcomes[0], null);
    assert.equal(outcomes[1], null);
    assert.equal(outcomes[2].status, 429);
    assert.equal(outcomes[2].code, "INVITATION_RESEND_RATE_LIMITED");
    assert.equal(outcomes[3], null, "a different invitation must have its own budget");
    assert.equal(outcomes[4], null, "a different actor must have its own budget");
});

test("invitation create is keyed per actor+studio, and invitation accept is keyed per actor", async () => {
    const store = createMemoryRateLimitStore();
    const { invitationCreate, invitationAccept } = createRateLimiters({
        store,
        keySecret: TEST_SECRET,
        now: () => 1000,
        policies: createRateLimitPolicies({
            env: { INVITATION_CREATE_RATE_LIMIT_MAX: "1", INVITATION_ACCEPT_RATE_LIMIT_MAX: "1" }
        })
    });
    const res = { setHeader() {} };
    const outcomes = [];

    await invitationCreate(request({ user: { id: 1 }, params: { studioId: "s1" } }), res, (e) => outcomes.push(e || null));
    await invitationCreate(request({ user: { id: 1 }, params: { studioId: "s1" } }), res, (e) => outcomes.push(e || null));
    await invitationCreate(request({ user: { id: 1 }, params: { studioId: "s2" } }), res, (e) => outcomes.push(e || null));
    assert.equal(outcomes[0], null);
    assert.equal(outcomes[1].status, 429);
    assert.equal(outcomes[2], null, "a different studio must have its own budget");

    outcomes.length = 0;
    await invitationAccept(request({ user: { id: 5 } }), res, (e) => outcomes.push(e || null));
    await invitationAccept(request({ user: { id: 5 } }), res, (e) => outcomes.push(e || null));
    assert.equal(outcomes[0], null);
    assert.equal(outcomes[1].status, 429);
});

test("refresh is keyed by client IP alone", async () => {
    const store = createMemoryRateLimitStore();
    const { refresh } = createRateLimiters({
        store,
        keySecret: TEST_SECRET,
        now: () => 1000,
        policies: createRateLimitPolicies({ env: { AUTH_REFRESH_RATE_LIMIT_MAX: "1" } })
    });
    const res = { setHeader() {} };
    const outcomes = [];
    await refresh(request({ ip: "1.2.3.4" }), res, (e) => outcomes.push(e || null));
    await refresh(request({ ip: "1.2.3.4" }), res, (e) => outcomes.push(e || null));
    await refresh(request({ ip: "5.6.7.8" }), res, (e) => outcomes.push(e || null));
    assert.equal(outcomes[0], null);
    assert.equal(outcomes[1].status, 429);
    assert.equal(outcomes[2], null, "a different IP must have its own budget");
});

test("logout-all is keyed by authenticated user, not IP", async () => {
    const store = createMemoryRateLimitStore();
    const { logoutAll } = createRateLimiters({
        store,
        keySecret: TEST_SECRET,
        now: () => 1000,
        policies: createRateLimitPolicies({ env: { AUTH_LOGOUT_ALL_RATE_LIMIT_MAX: "1" } })
    });
    const res = { setHeader() {} };
    const outcomes = [];
    await logoutAll(request({ ip: "9.9.9.9", user: { id: 1 } }), res, (e) => outcomes.push(e || null));
    await logoutAll(request({ ip: "9.9.9.9", user: { id: 2 } }), res, (e) => outcomes.push(e || null));
    await logoutAll(request({ ip: "9.9.9.9", user: { id: 1 } }), res, (e) => outcomes.push(e || null));
    assert.equal(outcomes[0], null);
    assert.equal(outcomes[1], null, "a different user sharing the same IP must have its own budget");
    assert.equal(outcomes[2].status, 429);
});

test("429 responses retain request ID and retry metadata", async () => {
    const store = createMemoryRateLimitStore();
    const { login } = createRateLimiters({
        store,
        keySecret: TEST_SECRET,
        now: () => 1000,
        policies: createRateLimitPolicies({ env: { AUTH_LOGIN_RATE_LIMIT_MAX: "1", AUTH_LOGIN_RATE_LIMIT_WINDOW_MS: "60000" } })
    });
    const headers = {};
    const res = {
        statusCode: 200,
        body: null,
        setHeader(name, value) { headers[name] = value; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
    const req = {
        headers: { "x-request-id": "rate-limit-request" },
        ip: "client-a",
        socket: { remoteAddress: "client-a" },
        body: { email: "someone@example.test" },
        method: "POST",
        originalUrl: "/api/users/login",
        app: { locals: { logger: { warn() {}, info() {}, error() {} } } }
    };

    requestIdMiddleware(req, res, () => {});
    await login(req, res, () => {});
    let limitedError;
    await login(req, res, (error) => { limitedError = error; });
    errorHandler(limitedError, req, res, () => {});

    assert.equal(res.statusCode, 429);
    assert.equal(headers["X-Request-ID"], "rate-limit-request");
    assert.equal(headers["Retry-After"], "60");
    assert.equal(res.body.error.requestId, "rate-limit-request");
    assert.equal(res.body.error.code, "RATE_LIMIT_EXCEEDED");
});

test("a store failure fails closed with RATE_LIMIT_BACKEND_UNAVAILABLE, never a silent allow", async () => {
    const failingStore = { consume: async () => { throw new (require("../../errors/RateLimitErrors").RateLimitStoreUnavailableError)("simulated outage"); } };
    const policies = createRateLimitPolicies({ env: {} });
    const middleware = createRateLimitMiddleware({
        policy: policies["auth.login"],
        store: failingStore,
        keySecret: TEST_SECRET
    });
    const res = { setHeader() {} };
    let error;
    await middleware(request({ body: { email: "x@example.test" } }), res, (e) => { error = e; });
    assert.equal(error.status, 503);
    assert.equal(error.code, "RATE_LIMIT_BACKEND_UNAVAILABLE");
    assert.doesNotMatch(error.message, /sql|mysql|ECONNREFUSED/i, "must not leak internal store details");
});

// Section 18: rate-limit logs may contain policy ID, outcome, HTTP status,
// Retry-After, and request ID - never an e-mail, IP, token, or the raw
// rate-limit key/secret.
test("Section 18: the 429 log entry contains only policy id/outcome/request id - never the e-mail or IP that triggered it", async () => {
    const entries = [];
    const logger = { info(event, fields) { entries.push({ event, fields }); }, warn() {}, error() {} };
    const store = createMemoryRateLimitStore();
    const { login } = createRateLimiters({
        store,
        keySecret: TEST_SECRET,
        now: () => 1000,
        policies: createRateLimitPolicies({ env: { AUTH_LOGIN_RATE_LIMIT_MAX: "1", AUTH_LOGIN_RATE_LIMIT_WINDOW_MS: "60000" } })
    });
    const res = { setHeader() {} };
    const email = "log-redaction-target@example.test";
    const req = request({ ip: "203.0.113.55", body: { email }, requestId: "redaction-check", app: { locals: { logger } } });

    await login(req, res, () => {});
    await login(req, res, () => {});

    const rateLimitLog = entries.find((entry) => entry.event === "rate_limit_exceeded");
    assert.ok(rateLimitLog, "expected a rate_limit_exceeded log entry");
    assert.deepEqual(Object.keys(rateLimitLog.fields).sort(), ["policyId", "requestId", "retryAfterSeconds"]);
    const serialized = JSON.stringify(entries);
    assert.equal(serialized.includes(email), false);
    assert.equal(serialized.includes("203.0.113.55"), false);
    assert.equal(serialized.includes(TEST_SECRET), false);
});

test("Section 18: an expected 429 is logged at info level, not warn/error - it is not an anomaly", async () => {
    const levels = [];
    const logger = {
        info(event) { levels.push(["info", event]); },
        warn(event) { levels.push(["warn", event]); },
        error(event) { levels.push(["error", event]); }
    };
    const store = createMemoryRateLimitStore();
    const { login } = createRateLimiters({
        store,
        keySecret: TEST_SECRET,
        now: () => 1000,
        policies: createRateLimitPolicies({ env: { AUTH_LOGIN_RATE_LIMIT_MAX: "1", AUTH_LOGIN_RATE_LIMIT_WINDOW_MS: "60000" } })
    });
    const res = { setHeader() {} };
    const req = request({ body: { email: "info-level-check@example.test" }, app: { locals: { logger } } });

    await login(req, res, () => {});
    await login(req, res, () => {});

    assert.deepEqual(levels, [["info", "rate_limit_exceeded"]]);
});

test("Section 18: the store-unavailable log entry contains only policy id and request id - never key material", async () => {
    const entries = [];
    const logger = {
        error(event, fields) { entries.push({ event, fields }); },
        info() {},
        warn() {}
    };
    const { RateLimitStoreUnavailableError } = require("../../errors/RateLimitErrors");
    const failingStore = { consume: async () => { throw new RateLimitStoreUnavailableError(`simulated outage for ${TEST_SECRET}`); } };
    const policies = createRateLimitPolicies({ env: {} });
    const middleware = createRateLimitMiddleware({ policy: policies["auth.login"], store: failingStore, keySecret: TEST_SECRET });
    const res = { setHeader() {} };
    const req = request({ body: { email: "outage-check@example.test" }, requestId: "outage-request-id", app: { locals: { logger } } });

    await middleware(req, res, () => {});

    const outageLog = entries.find((entry) => entry.event === "rate_limit_store_unavailable");
    assert.ok(outageLog);
    assert.deepEqual(Object.keys(outageLog.fields).sort(), ["policyId", "requestId"]);
    assert.equal(JSON.stringify(entries).includes("outage-check@example.test"), false);
});
