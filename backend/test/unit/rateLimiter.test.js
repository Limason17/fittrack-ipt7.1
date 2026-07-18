const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createAuthRateLimiters,
    createFixedWindowRateLimiter
} = require("../../middleware/rateLimiter");
const {
    errorHandler,
    requestIdMiddleware
} = require("../../middleware/httpFoundation");

function request(ip = "127.0.0.1") {
    return { ip, socket: { remoteAddress: ip } };
}

test("rate limiter allows the configured number and rejects the next request", () => {
    let time = 1000;
    const limiter = createFixedWindowRateLimiter({
        windowMs: 60_000,
        max: 2,
        now: () => time
    });
    const res = { setHeader() {} };
    const outcomes = [];

    limiter(request(), res, (error) => outcomes.push(error || null));
    limiter(request(), res, (error) => outcomes.push(error || null));
    limiter(request(), res, (error) => outcomes.push(error || null));

    assert.equal(outcomes[0], null);
    assert.equal(outcomes[1], null);
    assert.equal(outcomes[2].status, 429);
    assert.equal(outcomes[2].code, "RATE_LIMIT_EXCEEDED");

    time += 60_001;
    limiter(request(), res, (error) => outcomes.push(error || null));
    assert.equal(outcomes[3], null);
});

test("login and registration windows are independent and clients do not block each other", () => {
    const { login, registration } = createAuthRateLimiters({
        now: () => 1000,
        loginMax: 1,
        registrationMax: 1,
        loginWindowMs: 60_000,
        registrationWindowMs: 60_000
    });
    const headers = {};
    const res = { setHeader(name, value) { headers[name] = value; } };
    const outcomes = [];

    registration(request("client-a"), res, (error) => outcomes.push(error || null));
    registration(request("client-a"), res, (error) => outcomes.push(error || null));
    login(request("client-a"), res, (error) => outcomes.push(error || null));
    registration(request("client-b"), res, (error) => outcomes.push(error || null));

    assert.equal(outcomes[0], null);
    assert.equal(outcomes[1].status, 429);
    assert.equal(outcomes[2], null, "login limiter must not share registration state");
    assert.equal(outcomes[3], null, "another client key must remain available");
    assert.equal(headers["Retry-After"], "60");
    assert.equal(headers["RateLimit-Remaining"], "0");
});

test("429 responses retain request ID and retry metadata", () => {
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
        method: "POST",
        originalUrl: "/api/users/register",
        app: { locals: { logger: { warn() {} } } }
    };
    const limiter = createFixedWindowRateLimiter({
        windowMs: 60_000,
        max: 1,
        now: () => 1000
    });

    requestIdMiddleware(req, res, () => {});
    limiter(req, res, () => {});
    let limitedError;
    limiter(req, res, (error) => { limitedError = error; });
    errorHandler(limitedError, req, res, () => {});

    assert.equal(res.statusCode, 429);
    assert.equal(headers["X-Request-ID"], "rate-limit-request");
    assert.equal(headers["Retry-After"], "60");
    assert.equal(res.body.error.requestId, "rate-limit-request");
    assert.equal(res.body.error.code, "RATE_LIMIT_EXCEEDED");
});
