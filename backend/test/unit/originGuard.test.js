const test = require("node:test");
const assert = require("node:assert/strict");

const { createOriginGuard } = require("../../security/originGuard");

function run(guard, req) {
    let calledWith;
    guard(req, {}, (error) => { calledWith = error; });
    return calledWith;
}

test("a missing Origin header is allowed through (documented CLI/test exception)", () => {
    const guard = createOriginGuard({ getAllowedOrigins: () => ["http://localhost:5173"] });
    const req = { headers: { host: "localhost:3001" } };
    assert.equal(run(guard, req), undefined);
});

test("an Origin matching the allowlist is allowed", () => {
    const guard = createOriginGuard({ getAllowedOrigins: () => ["http://localhost:5173"] });
    const req = { headers: { origin: "http://localhost:5173", host: "localhost:3001" } };
    assert.equal(run(guard, req), undefined);
});

test("an Origin matching the request's own host (cross-port same-host) is allowed even if not in the allowlist", () => {
    const guard = createOriginGuard({ getAllowedOrigins: () => [] });
    const req = { headers: { origin: "http://127.0.0.1:4173", host: "127.0.0.1:4173" } };
    assert.equal(run(guard, req), undefined);
});

test("a present but disallowed Origin fails closed with AUTH_ORIGIN_NOT_ALLOWED", () => {
    const guard = createOriginGuard({ getAllowedOrigins: () => ["http://localhost:5173"] });
    const req = { headers: { origin: "http://evil.example", host: "localhost:3001" } };
    const error = run(guard, req);
    assert.equal(error?.code, "AUTH_ORIGIN_NOT_ALLOWED");
    assert.equal(error?.status, 403);
});

test("a malformed Origin header is rejected rather than throwing", () => {
    const guard = createOriginGuard({ getAllowedOrigins: () => [] });
    const req = { headers: { origin: "not a url", host: "localhost:3001" } };
    assert.equal(run(guard, req)?.code, "AUTH_ORIGIN_NOT_ALLOWED");
});

test("Origin allowlist matching is case-insensitive", () => {
    const guard = createOriginGuard({ getAllowedOrigins: () => ["http://localhost:5173"] });
    const req = { headers: { origin: "HTTP://LOCALHOST:5173", host: "localhost:3001" } };
    assert.equal(run(guard, req), undefined);
});

test("an error thrown while resolving the allowlist is forwarded, not swallowed", () => {
    const guard = createOriginGuard({
        getAllowedOrigins: () => { throw new Error("bad CORS_ALLOWED_ORIGINS config"); }
    });
    const req = { headers: { origin: "http://localhost:5173", host: "localhost:3001" } };
    const error = run(guard, req);
    assert.equal(error?.message, "bad CORS_ALLOWED_ORIGINS config");
});
