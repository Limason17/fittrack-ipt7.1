const test = require("node:test");
const assert = require("node:assert/strict");

const { createFixedWindowRateLimiter } = require("../../middleware/rateLimiter");

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
