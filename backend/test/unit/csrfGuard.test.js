const test = require("node:test");
const assert = require("node:assert/strict");

const { createCsrfGuard, timingSafeStringsEqual, CSRF_HEADER_NAME } = require("../../security/csrfGuard");

const config = { csrfCookieName: "fittrack_csrf" };

function run(req) {
    const guard = createCsrfGuard({ config });
    let calledWith;
    guard(req, {}, (error) => { calledWith = error; });
    return calledWith;
}

test("CSRF_HEADER_NAME is the lowercase custom header name Express normalizes to", () => {
    assert.equal(CSRF_HEADER_NAME, "x-csrf-token");
});

test("matching header and cookie values pass", () => {
    const req = { headers: { [CSRF_HEADER_NAME]: "abc123" }, cookies: { fittrack_csrf: "abc123" } };
    assert.equal(run(req), undefined);
});

test("mismatched header/cookie values are rejected as AUTH_CSRF_INVALID", () => {
    const req = { headers: { [CSRF_HEADER_NAME]: "abc123" }, cookies: { fittrack_csrf: "different" } };
    const error = run(req);
    assert.equal(error?.code, "AUTH_CSRF_INVALID");
    assert.equal(error?.status, 403);
});

test("a missing header is rejected", () => {
    const req = { headers: {}, cookies: { fittrack_csrf: "abc123" } };
    assert.equal(run(req)?.code, "AUTH_CSRF_INVALID");
});

test("a missing cookie is rejected", () => {
    const req = { headers: { [CSRF_HEADER_NAME]: "abc123" }, cookies: {} };
    assert.equal(run(req)?.code, "AUTH_CSRF_INVALID");
});

test("no cookies object at all (cookie-parser not applied) is rejected, not thrown", () => {
    const req = { headers: { [CSRF_HEADER_NAME]: "abc123" } };
    assert.equal(run(req)?.code, "AUTH_CSRF_INVALID");
});

test("timingSafeStringsEqual rejects empty strings and non-strings without throwing", () => {
    assert.equal(timingSafeStringsEqual("", ""), false);
    assert.equal(timingSafeStringsEqual("abc", undefined), false);
    assert.equal(timingSafeStringsEqual(undefined, undefined), false);
    assert.equal(timingSafeStringsEqual("abc", "abcd"), false);
    assert.equal(timingSafeStringsEqual("abc", "abc"), true);
});
