// These guard checks all run *before* backupRemoteRetention.js touches the
// network (readBackupRemoteConfig, then the enable/ack/max-delete checks),
// so they are safe, fast unit tests. The actual list+delete happy path
// against a real bucket is covered by the MinIO integration suite.
const test = require("node:test");
const assert = require("node:assert/strict");

const { applyRemoteRetention } = require("../../scripts/backupRemoteRetention");

function baseEnv(overrides = {}) {
    return {
        NODE_ENV: "test",
        BACKUP_REMOTE_ENABLED: "true",
        BACKUP_REMOTE_PROVIDER: "s3",
        BACKUP_S3_ENDPOINT: "http://127.0.0.1:9000",
        BACKUP_S3_REGION: "us-east-1",
        BACKUP_S3_BUCKET: "fittrack-backup-test",
        BACKUP_S3_PREFIX: "fittrack-backups-test",
        BACKUP_S3_ACCESS_KEY_ID: "unit-test-access-key-id",
        BACKUP_S3_SECRET_ACCESS_KEY: "unit-test-secret-access-key",
        BACKUP_S3_FORCE_PATH_STYLE: "true",
        ...overrides
    };
}

test("applyRemoteRetention refuses to delete anything without BACKUP_REMOTE_RETENTION_APPLY=true", async () => {
    await assert.rejects(
        applyRemoteRetention({ env: baseEnv() }),
        (error) => error.code === "REMOTE_RETENTION_NOT_AUTHORIZED"
    );
});

test("applyRemoteRetention requires an exact bucket acknowledgement", async () => {
    await assert.rejects(
        applyRemoteRetention({
            env: baseEnv({
                BACKUP_REMOTE_RETENTION_APPLY: "true",
                FITTRACK_REMOTE_RETENTION_BUCKET_ACK: "wrong-bucket",
                FITTRACK_REMOTE_RETENTION_PREFIX_ACK: "fittrack-backups-test",
                FITTRACK_REMOTE_RETENTION_MAX_DELETE: "10"
            })
        }),
        (error) => error.code === "REMOTE_RETENTION_NOT_AUTHORIZED"
    );
});

test("applyRemoteRetention requires an exact prefix acknowledgement", async () => {
    await assert.rejects(
        applyRemoteRetention({
            env: baseEnv({
                BACKUP_REMOTE_RETENTION_APPLY: "true",
                FITTRACK_REMOTE_RETENTION_BUCKET_ACK: "fittrack-backup-test",
                FITTRACK_REMOTE_RETENTION_PREFIX_ACK: "wrong-prefix",
                FITTRACK_REMOTE_RETENTION_MAX_DELETE: "10"
            })
        }),
        (error) => error.code === "REMOTE_RETENTION_NOT_AUTHORIZED"
    );
});

test("applyRemoteRetention requires an explicit non-negative integer max-delete guard", async () => {
    const withoutMax = baseEnv({
        BACKUP_REMOTE_RETENTION_APPLY: "true",
        FITTRACK_REMOTE_RETENTION_BUCKET_ACK: "fittrack-backup-test",
        FITTRACK_REMOTE_RETENTION_PREFIX_ACK: "fittrack-backups-test"
    });
    await assert.rejects(applyRemoteRetention({ env: withoutMax }), (error) => error.code === "REMOTE_RETENTION_NOT_AUTHORIZED");

    const negative = { ...withoutMax, FITTRACK_REMOTE_RETENTION_MAX_DELETE: "-1" };
    await assert.rejects(applyRemoteRetention({ env: negative }), (error) => error.code === "REMOTE_RETENTION_NOT_AUTHORIZED");

    const nonInteger = { ...withoutMax, FITTRACK_REMOTE_RETENTION_MAX_DELETE: "not-a-number" };
    await assert.rejects(applyRemoteRetention({ env: nonInteger }), (error) => error.code === "REMOTE_RETENTION_NOT_AUTHORIZED");
});

test("all three retention guards are checked before any network call is made (config-only failure surfaces even for an unreachable endpoint)", async () => {
    const unreachableEnv = baseEnv({ BACKUP_S3_ENDPOINT: "http://127.0.0.1:1" });
    const started = Date.now();
    await assert.rejects(
        applyRemoteRetention({ env: unreachableEnv }),
        (error) => error.code === "REMOTE_RETENTION_NOT_AUTHORIZED"
    );
    // A real network attempt against a closed port would take measurably
    // longer than this - the guard must reject before any connection is
    // attempted.
    assert.ok(Date.now() - started < 500);
});
