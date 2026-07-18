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

    const invitationToken = `_${"a".repeat(41)}-`;
    const error = new Error(
        "connect password=hunter2 token=abc123 " +
        "mysql://root:supersecret@internal-db/fittrack " +
        `https://app.example.test/invitations/${invitationToken}`
    );
    error.code = "ECONNREFUSED";
    logger.error("startup_failed", {
        error,
        password: "plain-secret",
        dbPassword: "database-secret",
        jwt: "eyJheader.payload.signature",
        refresh: "refresh-secret",
        cookie: "session=private-cookie",
        nested: { authorization: "Bearer secret-token" }
    });

    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.level, "error");
    assert.equal(parsed.event, "startup_failed");
    assert.equal(parsed.error.code, "ECONNREFUSED");
    assert.equal(typeof parsed.error.stack, "string");
    assert.equal(parsed.password, "[REDACTED]");
    assert.equal(parsed.nested.authorization, "[REDACTED]");

    for (const secret of [
        "hunter2",
        "abc123",
        "supersecret",
        "plain-secret",
        "database-secret",
        "eyJheader.payload.signature",
        "refresh-secret",
        "private-cookie",
        "secret-token",
        invitationToken
    ]) {
        assert.equal(lines[0].includes(secret), false);
    }
});
