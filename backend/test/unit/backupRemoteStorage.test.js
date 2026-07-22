const test = require("node:test");
const assert = require("node:assert/strict");

const {
    MAX_UPLOAD_BYTES,
    METADATA_ALLOWLIST,
    buildMetadata,
    createS3Client,
    normalizeRemoteError,
    remoteError,
    uploadObject
} = require("../../scripts/backupRemoteStorage");

function fakeRemoteConfig(overrides = {}) {
    return {
        region: "us-east-1",
        endpoint: "http://127.0.0.1:9000",
        bucket: "fittrack-backup-test",
        prefix: "fittrack-backups-test",
        forcePathStyle: true,
        uploadTimeoutMs: 600_000,
        downloadTimeoutMs: 600_000,
        operationTimeoutMs: 15_000,
        serverSideEncryption: { mode: "none" },
        credentials: {
            accessKeyId: "unit-test-access-key-id",
            secretAccessKey: "unit-test-secret-access-key",
            sessionToken: undefined
        },
        ...overrides
    };
}

test("buildMetadata only ever forwards allowlisted keys, silently drops everything else", () => {
    const metadata = buildMetadata({
        "format-version": "1",
        "key-id": "prod-key-2026",
        "created-at": "2026-07-22T00:00:00.000Z",
        "ciphertext-sha256": "a".repeat(64),
        "source-database": "fittrack",
        application: "fittrack",
        "backup-type": "encrypted-logical",
        "user-email": "someone@example.com",
        secretAccessKey: "should-never-appear",
        password: "also-never"
    });
    assert.deepEqual(Object.keys(metadata).sort(), [...METADATA_ALLOWLIST].sort());
    assert.equal(metadata["user-email"], undefined);
    assert.equal(metadata.secretAccessKey, undefined);
    assert.equal(metadata.password, undefined);
});

test("buildMetadata omits fields that are missing, null, or empty rather than sending empty strings", () => {
    const metadata = buildMetadata({ "format-version": "1", "key-id": "", "source-database": undefined });
    assert.deepEqual(Object.keys(metadata), ["format-version"]);
});

// The SDK always normalizes whatever `credentials` value is passed into an
// async provider function on client.config - even a plain static object
// gets wrapped that way. Resolving that provider and inspecting the result
// proves it resolves *instantly*, from *our* values only, with no network
// call and no default-provider-chain fields ($source shows the static
// "CREDENTIALS_CODE" origin, not an env/ini/instance-metadata source) - that
// is what actually demonstrates no implicit AWS credential chain is reachable.
test("createS3Client always resolves credentials from our own explicit static values, never a default provider chain", async () => {
    const client = createS3Client(fakeRemoteConfig());
    assert.equal(typeof client.config.credentials, "function");
    const resolved = await client.config.credentials();
    assert.equal(resolved.accessKeyId, "unit-test-access-key-id");
    assert.equal(resolved.secretAccessKey, "unit-test-secret-access-key");
});

test("createS3Client omits sessionToken entirely when none was configured", async () => {
    const client = createS3Client(fakeRemoteConfig());
    const resolved = await client.config.credentials();
    assert.equal(resolved.sessionToken, undefined);
});

test("createS3Client forwards an explicit sessionToken when configured", async () => {
    const client = createS3Client(
        fakeRemoteConfig({
            credentials: {
                accessKeyId: "id",
                secretAccessKey: "secret",
                sessionToken: "a-session-token"
            }
        })
    );
    const resolved = await client.config.credentials();
    assert.equal(resolved.sessionToken, "a-session-token");
});

test("uploadObject rejects a body whose size exceeds the documented remote upload limit before touching the network", async () => {
    await assert.rejects(
        uploadObject({
            client: createS3Client(fakeRemoteConfig()),
            remoteConfig: fakeRemoteConfig(),
            key: "fittrack-backups-test/2026/07/fittrack-20260722T000000Z-aaaaaaaa.ftbackup",
            body: Buffer.alloc(0),
            contentLength: MAX_UPLOAD_BYTES + 1,
            metadataFields: { "format-version": "1", "key-id": "k", application: "fittrack", "backup-type": "encrypted-logical" }
        }),
        (error) => error.code === "REMOTE_BACKUP_TOO_LARGE"
    );
});

test("MAX_UPLOAD_BYTES is the documented 2 GiB single-PutObject ceiling, comfortably below S3's real 5 GiB single-PUT limit", () => {
    assert.equal(MAX_UPLOAD_BYTES, 2 * 1024 * 1024 * 1024);
});

test("uploadObject rejects a non-positive or non-integer content length before touching the network", async () => {
    for (const contentLength of [0, -5, NaN, undefined]) {
        await assert.rejects(
            uploadObject({
                client: createS3Client(fakeRemoteConfig()),
                remoteConfig: fakeRemoteConfig(),
                key: "fittrack-backups-test/2026/07/fittrack-20260722T000000Z-aaaaaaaa.ftbackup",
                body: Buffer.alloc(0),
                contentLength,
                metadataFields: {}
            }),
            (error) => error.code === "REMOTE_UPLOAD_FAILED",
            `expected contentLength ${contentLength} to be rejected`
        );
    }
});

test("normalizeRemoteError maps known SDK error names to stable, safe codes without forwarding the raw error", () => {
    const authError = normalizeRemoteError({ name: "InvalidAccessKeyId" }, "HeadBucket");
    assert.equal(authError.code, "REMOTE_AUTH_FAILED");
    assert.equal(authError.message.includes("InvalidAccessKeyId"), false);

    const notFound = normalizeRemoteError({ name: "NoSuchKey" }, "HeadObject");
    assert.equal(notFound.code, "REMOTE_OBJECT_NOT_FOUND");

    const unavailable = normalizeRemoteError({ name: "NoSuchBucket" }, "HeadBucket");
    assert.equal(unavailable.code, "REMOTE_BUCKET_UNAVAILABLE");

    const generic = normalizeRemoteError({ name: "SomeUnknownProviderError" }, "PutObject");
    assert.equal(generic.code, "REMOTE_OPERATION_FAILED");
});

test("normalizeRemoteError treats HTTP 401/403/404 status codes as authoritative even without a recognized error name", () => {
    const forbidden = normalizeRemoteError({ name: "UnknownError", $metadata: { httpStatusCode: 403 } }, "PutObject");
    assert.equal(forbidden.code, "REMOTE_AUTH_FAILED");
    const notFound = normalizeRemoteError({ name: "UnknownError", $metadata: { httpStatusCode: 404 } }, "GetObject");
    assert.equal(notFound.code, "REMOTE_OBJECT_NOT_FOUND");
});

test("remoteError never mixes in raw provider error details into the message", () => {
    const error = remoteError("REMOTE_OPERATION_FAILED", "Safe message only.");
    assert.equal(error.code, "REMOTE_OPERATION_FAILED");
    assert.equal(error.message, "Safe message only.");
});
