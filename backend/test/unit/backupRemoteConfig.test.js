const test = require("node:test");
const assert = require("node:assert/strict");

const { readBackupRemoteConfig, isBackupRemoteEnabled } = require("../../config/backupRemoteConfig");

function validEnv(overrides = {}) {
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

test("isBackupRemoteEnabled is false unless BACKUP_REMOTE_ENABLED is exactly \"true\"", () => {
    assert.equal(isBackupRemoteEnabled({}), false);
    assert.equal(isBackupRemoteEnabled({ BACKUP_REMOTE_ENABLED: "1" }), false);
    assert.equal(isBackupRemoteEnabled({ BACKUP_REMOTE_ENABLED: "true" }), true);
});

test("readBackupRemoteConfig throws when BACKUP_REMOTE_ENABLED is missing or not exactly true", () => {
    assert.throws(
        () => readBackupRemoteConfig(validEnv({ BACKUP_REMOTE_ENABLED: undefined })),
        (error) => error.code === "INVALID_BACKUP_REMOTE_CONFIG"
    );
    assert.throws(
        () => readBackupRemoteConfig(validEnv({ BACKUP_REMOTE_ENABLED: "yes" })),
        (error) => error.code === "INVALID_BACKUP_REMOTE_CONFIG"
    );
});

test("a fully valid configuration parses cleanly and freezes its result", () => {
    const config = readBackupRemoteConfig(validEnv());
    assert.equal(config.bucket, "fittrack-backup-test");
    assert.equal(config.prefix, "fittrack-backups-test");
    assert.equal(config.region, "us-east-1");
    assert.equal(config.forcePathStyle, true);
    assert.equal(config.requireVersioning, false);
    assert.equal(config.requireObjectLock, false);
    assert.equal(config.serverSideEncryption.mode, "none");
    assert.ok(Object.isFrozen(config));
    assert.ok(Object.isFrozen(config.credentials));
});

test("rejects an unsupported remote provider", () => {
    assert.throws(
        () => readBackupRemoteConfig(validEnv({ BACKUP_REMOTE_PROVIDER: "azure-blob" })),
        (error) => error.code === "INVALID_BACKUP_REMOTE_CONFIG"
    );
});

test("bucket name validation rejects invalid shapes and accepts valid ones", () => {
    for (const bad of ["AB", "Has_Upper_Case", "a", "-leading-hyphen", "trailing-hyphen-", "has..dots", "192.168.0.1"]) {
        assert.throws(
            () => readBackupRemoteConfig(validEnv({ BACKUP_S3_BUCKET: bad })),
            (error) => error.code === "INVALID_BACKUP_REMOTE_CONFIG",
            `expected "${bad}" to be rejected`
        );
    }
    const config = readBackupRemoteConfig(validEnv({ BACKUP_S3_BUCKET: "fittrack-real-backups-2026" }));
    assert.equal(config.bucket, "fittrack-real-backups-2026");
});

test("prefix normalization rejects '..' segments, backslashes, leading/trailing/duplicate slashes, and control characters", () => {
    const badPrefixes = [
        "../escape",
        "fittrack/../escape",
        "fittrack\\backups",
        "/leading-slash",
        "trailing-slash/",
        "double//slash",
        "fittrack backups",
        "fittrack\tbackups"
    ];
    for (const prefix of badPrefixes) {
        assert.throws(
            () => readBackupRemoteConfig(validEnv({ BACKUP_S3_PREFIX: prefix })),
            (error) => error.code === "INVALID_BACKUP_REMOTE_CONFIG",
            `expected prefix "${prefix}" to be rejected`
        );
    }
    const config = readBackupRemoteConfig(validEnv({ BACKUP_S3_PREFIX: "fittrack-backups/pilot" }));
    assert.equal(config.prefix, "fittrack-backups/pilot");
});

test("HTTPS/loopback endpoint rules: http is only allowed for an explicit loopback endpoint outside production", () => {
    // http + loopback outside production: allowed
    const config = readBackupRemoteConfig(validEnv({ BACKUP_S3_ENDPOINT: "http://127.0.0.1:9000" }));
    assert.equal(config.endpoint, "http://127.0.0.1:9000/");

    // http + non-loopback host: rejected even outside production
    assert.throws(
        () => readBackupRemoteConfig(validEnv({ BACKUP_S3_ENDPOINT: "http://s3.example.com" })),
        (error) => error.code === "INVALID_BACKUP_REMOTE_CONFIG"
    );

    // http in production: rejected even for a loopback host
    assert.throws(
        () =>
            readBackupRemoteConfig(
                validEnv({ NODE_ENV: "production", BACKUP_S3_ENDPOINT: "http://127.0.0.1:9000" })
            ),
        (error) => error.code === "INVALID_BACKUP_REMOTE_CONFIG"
    );

    // https in production: allowed
    const prodConfig = readBackupRemoteConfig(
        validEnv({ NODE_ENV: "production", BACKUP_S3_ENDPOINT: "https://s3.example.com" })
    );
    assert.equal(prodConfig.endpoint, "https://s3.example.com/");

    // not a valid URL at all
    assert.throws(
        () => readBackupRemoteConfig(validEnv({ BACKUP_S3_ENDPOINT: "not a url" })),
        (error) => error.code === "INVALID_BACKUP_REMOTE_CONFIG"
    );
});

test("access key and secret must be configured together, never partially", () => {
    assert.throws(
        () => readBackupRemoteConfig(validEnv({ BACKUP_S3_SECRET_ACCESS_KEY: undefined })),
        (error) => error.code === "INVALID_BACKUP_REMOTE_CONFIG"
    );
    assert.throws(
        () => readBackupRemoteConfig(validEnv({ BACKUP_S3_ACCESS_KEY_ID: undefined })),
        (error) => error.code === "INVALID_BACKUP_REMOTE_CONFIG"
    );
});

test("never falls back to generic AWS_* environment variables even when they are present", () => {
    const env = validEnv({
        BACKUP_S3_ACCESS_KEY_ID: undefined,
        BACKUP_S3_SECRET_ACCESS_KEY: undefined,
        AWS_ACCESS_KEY_ID: "a-real-looking-personal-access-key",
        AWS_SECRET_ACCESS_KEY: "a-real-looking-personal-secret-key",
        AWS_PROFILE: "personal-profile"
    });
    assert.throws(() => readBackupRemoteConfig(env), (error) => error.code === "INVALID_BACKUP_REMOTE_CONFIG");
});

test("session token is optional and passed through only when present", () => {
    const withoutToken = readBackupRemoteConfig(validEnv());
    assert.equal(withoutToken.credentials.sessionToken, undefined);
    const withToken = readBackupRemoteConfig(validEnv({ BACKUP_S3_SESSION_TOKEN: "a-session-token-value" }));
    assert.equal(withToken.credentials.sessionToken, "a-session-token-value");
});

test("known placeholder values are rejected for bucket, access key, and secret key", () => {
    assert.throws(
        () => readBackupRemoteConfig(validEnv({ BACKUP_S3_BUCKET: "your-bucket-name" })),
        (error) => error.code === "INVALID_BACKUP_REMOTE_CONFIG"
    );
    assert.throws(
        () => readBackupRemoteConfig(validEnv({ BACKUP_S3_ACCESS_KEY_ID: "changeme", BACKUP_S3_SECRET_ACCESS_KEY: "changeme" })),
        (error) => error.code === "INVALID_BACKUP_REMOTE_CONFIG"
    );
});

test("forcePathStyle, requireVersioning, and requireObjectLock must be exactly \"true\" or \"false\"", () => {
    for (const name of ["BACKUP_S3_FORCE_PATH_STYLE", "BACKUP_S3_REQUIRE_VERSIONING", "BACKUP_S3_REQUIRE_OBJECT_LOCK"]) {
        assert.throws(
            () => readBackupRemoteConfig(validEnv({ [name]: "yes" })),
            (error) => error.code === "INVALID_BACKUP_REMOTE_CONFIG",
            `expected ${name}=yes to be rejected`
        );
    }
    const config = readBackupRemoteConfig(
        validEnv({ BACKUP_S3_REQUIRE_VERSIONING: "true", BACKUP_S3_REQUIRE_OBJECT_LOCK: "true" })
    );
    assert.equal(config.requireVersioning, true);
    assert.equal(config.requireObjectLock, true);
});

test("upload/download/operation timeouts fall back to safe defaults and enforce min/max bounds", () => {
    const defaults = readBackupRemoteConfig(validEnv());
    assert.equal(defaults.uploadTimeoutMs, 600_000);
    assert.equal(defaults.downloadTimeoutMs, 600_000);
    assert.equal(defaults.operationTimeoutMs, 15_000);

    assert.throws(
        () => readBackupRemoteConfig(validEnv({ BACKUP_S3_UPLOAD_TIMEOUT_MS: "100" })),
        (error) => error.code === "INVALID_BACKUP_REMOTE_CONFIG"
    );
    assert.throws(
        () => readBackupRemoteConfig(validEnv({ BACKUP_S3_OPERATION_TIMEOUT_MS: "999999999" })),
        (error) => error.code === "INVALID_BACKUP_REMOTE_CONFIG"
    );

    const custom = readBackupRemoteConfig(validEnv({ BACKUP_S3_UPLOAD_TIMEOUT_MS: "30000" }));
    assert.equal(custom.uploadTimeoutMs, 30_000);
});

test("server-side encryption defaults to none, accepts AES256, and requires a KMS key id for aws:kms", () => {
    const none = readBackupRemoteConfig(validEnv());
    assert.equal(none.serverSideEncryption.mode, "none");

    const aes = readBackupRemoteConfig(validEnv({ BACKUP_S3_SERVER_SIDE_ENCRYPTION: "AES256" }));
    assert.equal(aes.serverSideEncryption.mode, "AES256");

    assert.throws(
        () => readBackupRemoteConfig(validEnv({ BACKUP_S3_SERVER_SIDE_ENCRYPTION: "aws:kms" })),
        (error) => error.code === "INVALID_BACKUP_REMOTE_CONFIG"
    );

    const kms = readBackupRemoteConfig(
        validEnv({
            BACKUP_S3_SERVER_SIDE_ENCRYPTION: "aws:kms",
            BACKUP_S3_KMS_KEY_ID: "arn:aws:kms:eu-central-1:111122223333:key/abcd-1234"
        })
    );
    assert.equal(kms.serverSideEncryption.mode, "aws:kms");
    assert.equal(kms.serverSideEncryption.kmsKeyId, "arn:aws:kms:eu-central-1:111122223333:key/abcd-1234");

    assert.throws(
        () => readBackupRemoteConfig(validEnv({ BACKUP_S3_SERVER_SIDE_ENCRYPTION: "des" })),
        (error) => error.code === "INVALID_BACKUP_REMOTE_CONFIG"
    );
});

test("region must be explicitly configured and match the expected charset", () => {
    assert.throws(
        () => readBackupRemoteConfig(validEnv({ BACKUP_S3_REGION: undefined })),
        (error) => error.code === "INVALID_BACKUP_REMOTE_CONFIG"
    );
    assert.throws(
        () => readBackupRemoteConfig(validEnv({ BACKUP_S3_REGION: "EU-Central-1" })),
        (error) => error.code === "INVALID_BACKUP_REMOTE_CONFIG"
    );
});
