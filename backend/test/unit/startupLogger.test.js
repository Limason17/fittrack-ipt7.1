const assert = require("node:assert/strict");
const test = require("node:test");

const { createStructuredLogger } = require("../../startup/logger");

test("strukturierte Logs sind valides JSON und redigieren Secrets rekursiv", () => {
    const lines = [];
    const logger = createStructuredLogger({
        log(line) {
            lines.push(line);
        },
        warn(line) {
            lines.push(line);
        },
        error(line) {
            lines.push(line);
        }
    });

    const error = new Error(
        "connect password=hunter2 token=abc123 mysql://root:supersecret@internal-db/fittrack"
    );
    error.code = "ECONNREFUSED";
    logger.error("startup_failed", {
        error,
        password: "plain-secret",
        nested: { authorization: "Bearer secret-token" }
    });

    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.level, "error");
    assert.equal(parsed.event, "startup_failed");
    assert.equal(parsed.error.code, "ECONNREFUSED");
    assert.equal(parsed.password, "[REDACTED]");
    assert.equal(parsed.nested.authorization, "[REDACTED]");

    for (const secret of [
        "hunter2",
        "abc123",
        "supersecret",
        "plain-secret",
        "secret-token"
    ]) {
        assert.equal(lines[0].includes(secret), false);
    }
});
