const test = require("node:test");
const assert = require("node:assert/strict");

const { AuthorizationError, ValidationError } = require("../../errors/AppError");
const {
    errorHandler,
    requestIdMiddleware,
    securityHeaders
} = require("../../middleware/httpFoundation");

function responseDouble() {
    return {
        headers: {},
        statusCode: 200,
        body: null,
        setHeader(name, value) {
            this.headers[name.toLowerCase()] = value;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };
}

test("request IDs are generated and returned as response headers", () => {
    const req = { headers: {} };
    const res = responseDouble();
    let called = false;

    requestIdMiddleware(req, res, () => { called = true; });

    assert.equal(called, true);
    assert.match(req.requestId, /^[0-9a-f-]{36}$/);
    assert.equal(res.headers["x-request-id"], req.requestId);
});

test("known errors use the stable envelope and request ID", () => {
    const req = {
        requestId: "test-request-id",
        method: "POST",
        originalUrl: "/api/workouts",
        app: { locals: { logger: { error() {} } } }
    };
    const res = responseDouble();
    const error = new ValidationError({ weight: "Weight is invalid." });

    errorHandler(error, req, res, () => {});

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, {
        error: {
            code: "VALIDATION_ERROR",
            message: "The request contains invalid values.",
            fields: { weight: "Weight is invalid." },
            requestId: "test-request-id"
        }
    });
});

test("unknown errors never expose internal details", () => {
    const req = {
        requestId: "test-request-id",
        method: "GET",
        originalUrl: "/api/progress",
        app: { locals: { logger: { error() {} } } }
    };
    const res = responseDouble();

    errorHandler(new Error("SELECT failed at C:\\secret\\file.js"), req, res, () => {});

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error.code, "INTERNAL_ERROR");
    assert.equal(res.body.error.message, "An unexpected error occurred.");
    assert.doesNotMatch(JSON.stringify(res.body), /SELECT|secret|file\.js/);
});

test("authorization errors remain distinct from authentication failures", () => {
    const req = {
        requestId: "test-request-id",
        method: "DELETE",
        originalUrl: "/api/progress/1",
        app: { locals: { logger: { error() {} } } }
    };
    const res = responseDouble();
    errorHandler(new AuthorizationError(), req, res, () => {});
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, "FORBIDDEN");
});

test("malformed JSON is a client error without parser details", () => {
    const req = {
        requestId: "test-request-id",
        method: "POST",
        originalUrl: "/api/workouts",
        app: { locals: { logger: { error() {} } } }
    };
    const res = responseDouble();
    const parserError = new SyntaxError("Unexpected token at position 12");
    parserError.type = "entity.parse.failed";
    errorHandler(parserError, req, res, () => {});
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, "INVALID_JSON");
    assert.doesNotMatch(JSON.stringify(res.body), /Unexpected token|position 12/);
});

test("baseline security headers are added", () => {
    const req = {};
    const res = responseDouble();
    securityHeaders(req, res, () => {});
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["x-frame-options"], "DENY");
    assert.equal(res.headers["referrer-policy"], "no-referrer");
});
