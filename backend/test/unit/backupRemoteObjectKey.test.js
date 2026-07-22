const test = require("node:test");
const assert = require("node:assert/strict");

const {
    assertBackupFilename,
    assertObjectKeyWithinPrefix,
    buildRemoteObjectKey
} = require("../../scripts/backupRemoteObjectKey");

const VALID_FILENAME = "fittrack-20260722T010203Z-a1b2c3d4.ftbackup";

test("buildRemoteObjectKey produces the documented <prefix>/<year>/<month>/<filename> layout", () => {
    const key = buildRemoteObjectKey({
        prefix: "fittrack-backups",
        filename: VALID_FILENAME,
        now: new Date("2026-07-22T01:02:03.000Z")
    });
    assert.equal(key, "fittrack-backups/2026/07/fittrack-20260722T010203Z-a1b2c3d4.ftbackup");
});

test("buildRemoteObjectKey pads single-digit UTC months", () => {
    const key = buildRemoteObjectKey({
        prefix: "fittrack-backups",
        filename: VALID_FILENAME,
        now: new Date("2026-01-05T00:00:00.000Z")
    });
    assert.match(key, /^fittrack-backups\/2026\/01\//);
});

test("only the exact fittrack-<timestamp>-<random>.ftbackup filename shape is accepted", () => {
    assert.doesNotThrow(() => assertBackupFilename(VALID_FILENAME));
    for (const bad of [
        "fittrack.sql",
        "fittrack-20260722T010203Z-a1b2c3d4.sql.gz",
        "../escape.ftbackup",
        "fittrack-not-a-timestamp-a1b2c3d4.ftbackup",
        "randomfile.ftbackup",
        ""
    ]) {
        assert.throws(
            () => assertBackupFilename(bad),
            (error) => error.code === "REMOTE_OBJECT_KEY_INVALID",
            `expected "${bad}" to be rejected`
        );
    }
});

test("assertObjectKeyWithinPrefix rejects keys outside the configured prefix", () => {
    assert.throws(
        () => assertObjectKeyWithinPrefix("fittrack-backups", `other-prefix/2026/07/${VALID_FILENAME}`),
        (error) => error.code === "REMOTE_OBJECT_KEY_OUTSIDE_PREFIX"
    );
    assert.throws(
        () => assertObjectKeyWithinPrefix("fittrack-backups", `fittrack-backups-evil/2026/07/${VALID_FILENAME}`),
        (error) => error.code === "REMOTE_OBJECT_KEY_OUTSIDE_PREFIX"
    );
});

test("assertObjectKeyWithinPrefix rejects '..' traversal, backslashes, and non-.ftbackup keys even if they otherwise start with the prefix", () => {
    for (const key of [
        `fittrack-backups/../secrets/${VALID_FILENAME}`,
        `fittrack-backups\\2026\\07\\${VALID_FILENAME}`,
        "fittrack-backups/2026/07/not-a-backup.txt",
        "/fittrack-backups/2026/07/" + VALID_FILENAME,
        `fittrack-backups//2026/07/${VALID_FILENAME}`
    ]) {
        assert.throws(
            () => assertObjectKeyWithinPrefix("fittrack-backups", key),
            (error) => error.code === "REMOTE_OBJECT_KEY_INVALID" || error.code === "REMOTE_OBJECT_KEY_OUTSIDE_PREFIX",
            `expected "${key}" to be rejected`
        );
    }
});

test("assertObjectKeyWithinPrefix accepts a key that is genuinely inside the prefix", () => {
    const key = `fittrack-backups/2026/07/${VALID_FILENAME}`;
    assert.equal(assertObjectKeyWithinPrefix("fittrack-backups", key), key);
});

test("buildRemoteObjectKey never returns a key that assertObjectKeyWithinPrefix would reject", () => {
    const key = buildRemoteObjectKey({ prefix: "a/b", filename: VALID_FILENAME, now: new Date() });
    assert.equal(assertObjectKeyWithinPrefix("a/b", key), key);
});
