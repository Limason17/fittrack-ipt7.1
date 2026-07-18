const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const {
    createRequestLoggingMiddleware,
    requestRoute
} = require("../../middleware/httpFoundation");

test("request logging emits only bounded metadata after the response finishes", () => {
    const entries = [];
    const logger = {
        info(event, fields) {
            entries.push({ event, fields });
        }
    };
    const req = {
        requestId: "stage0b-request-id",
        method: "POST",
        baseUrl: "/api/workouts",
        route: { path: "/:id" },
        path: "/42",
        originalUrl: "/api/workouts/42?token=must-not-appear",
        body: { password: "must-not-appear" },
        app: { locals: { logger } }
    };
    const res = new EventEmitter();
    res.statusCode = 204;
    const times = [100, 112.345];
    const middleware = createRequestLoggingMiddleware({ now: () => times.shift() });
    let nextCalled = false;

    middleware(req, res, () => { nextCalled = true; });
    res.emit("finish");

    assert.equal(nextCalled, true);
    assert.deepEqual(entries, [{
        event: "api_request_completed",
        fields: {
            requestId: "stage0b-request-id",
            method: "POST",
            route: "/api/workouts/:id",
            status: 204,
            durationMs: 12.35
        }
    }]);
    assert.equal(JSON.stringify(entries).includes("must-not-appear"), false);
});

test("request route never includes query values and falls back safely", () => {
    assert.equal(requestRoute({
        baseUrl: "/api/progress",
        route: { path: "/summary" }
    }), "/api/progress/summary");
    assert.equal(requestRoute({
        path: "/missing",
        originalUrl: "/missing?jwt=secret"
    }), "/missing");
});
