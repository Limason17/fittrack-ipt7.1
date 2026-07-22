// Real, end-to-end proof of the Stage 2B2A off-host storage pipeline
// against a genuine local MinIO instance (docker compose --profile
// backup-test up -d minio) and the real local MySQL container - no mocks,
// no fakes. Requires FITTRACK_DB_CONTAINER-resolvable MySQL (see
// encryptedBackupRestoreDrill.test.js for the identical convention) and
// MinIO reachable at BACKUP_S3_ENDPOINT (default: http://127.0.0.1:9000).
const { after, before, beforeEach, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const mysql = require("mysql2/promise");
const {
    CreateBucketCommand,
    GetObjectCommand,
    PutBucketVersioningCommand,
    PutObjectCommand
} = require("@aws-sdk/client-s3");

const TEST_DATABASE = `fittrack_remote_drill_${process.pid}_${Date.now()}`;
if (!/^fittrack_remote_drill_[A-Za-z0-9_]+$/.test(TEST_DATABASE)) {
    throw new Error("Refusing to use an unsafe remote-backup test database name.");
}

process.env.NODE_ENV = "test";
process.env.DB_NAME = TEST_DATABASE;
process.env.JWT_SECRET = "fittrack-remote-backup-test-secret-with-at-least-32-characters";
process.env.INVITATION_ACCEPT_BASE_URL = "http://127.0.0.1:4173";
process.env.INVITATION_EMAIL_PROVIDER = "";

const db = require("../../config/db");
const { createMigrationRunner } = require("../../migrations/runner");
const { readBackupRemoteConfig } = require("../../config/backupRemoteConfig");
const { createEncryptedBackup } = require("../../scripts/encryptedBackupCreate");
const { uploadEncryptedBackup } = require("../../scripts/encryptedBackupRemoteUpload");
const { listRemoteBackups } = require("../../scripts/encryptedBackupRemoteList");
const { downloadRemoteBackup } = require("../../scripts/encryptedBackupRemoteDownload");
const { verifyRemoteBackup } = require("../../scripts/encryptedBackupRemoteVerify");
const { runRemoteRestoreDrill } = require("../../scripts/encryptedBackupRemoteDrill");
const { runRemoteBackupPreflight } = require("../../scripts/backupRemotePreflight");
const { planRemoteRetention, applyRemoteRetention } = require("../../scripts/backupRemoteRetention");
const {
    createS3Client,
    downloadObjectToSink,
    headObject,
    uploadObject,
    remoteError
} = require("../../scripts/backupRemoteStorage");
const { ensureTestBucketReady, purgeTestPrefix } = require("../helpers/minioTestBucket");

const NOOP_LOGGER = { info() {}, warn() {}, error() {} };
const TEST_BUCKET = process.env.FITTRACK_S3_TEST_BUCKET || "fittrack-backup-test";
const TEST_ENDPOINT = process.env.FITTRACK_S3_TEST_ENDPOINT || "http://127.0.0.1:9000";
const TEST_ACCESS_KEY = process.env.FITTRACK_S3_TEST_ACCESS_KEY || "fittrack-test-minio-user";
const TEST_SECRET_KEY = process.env.FITTRACK_S3_TEST_SECRET_KEY || "fittrack-test-minio-password";

let adminConnection;
let backupDirectory;
let downloadDirectory;
let client;

function randomPrefix() {
    return `fittrack-backups-test-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
}

let testPrefix;

function baseEnv(overrides = {}) {
    return {
        ...process.env,
        FITTRACK_DB_CONTAINER: process.env.FITTRACK_DB_CONTAINER || "fittrack_mysql",
        BACKUP_ENCRYPTION_KEY_B64: crypto.randomBytes(32).toString("base64"),
        BACKUP_ENCRYPTION_KEY_ID: "remote-integration-test-key",
        BACKUP_OUTPUT_DIRECTORY: backupDirectory,
        BACKUP_REMOTE_ENABLED: "true",
        BACKUP_REMOTE_PROVIDER: "s3",
        BACKUP_S3_ENDPOINT: TEST_ENDPOINT,
        BACKUP_S3_REGION: "us-east-1",
        BACKUP_S3_BUCKET: TEST_BUCKET,
        BACKUP_S3_PREFIX: testPrefix,
        BACKUP_S3_ACCESS_KEY_ID: TEST_ACCESS_KEY,
        BACKUP_S3_SECRET_ACCESS_KEY: TEST_SECRET_KEY,
        BACKUP_S3_FORCE_PATH_STYLE: "true",
        ...overrides
    };
}

before(async () => {
    adminConnection = await mysql.createConnection(
        db.readDatabaseConfig(process.env, { includeDatabase: false })
    );
    await adminConnection.query(`CREATE DATABASE \`${TEST_DATABASE}\` CHARACTER SET utf8mb4`);
    const runner = createMigrationRunner({ pool: db, logger: NOOP_LOGGER });
    await runner.migrate({ expectedDatabase: TEST_DATABASE });

    backupDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "fittrack-remote-backup-"));
    downloadDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "fittrack-remote-download-"));
    testPrefix = randomPrefix();

    const remoteConfig = readBackupRemoteConfig(baseEnv());
    client = await ensureTestBucketReady(remoteConfig);
});

beforeEach(async () => {
    const remoteConfig = readBackupRemoteConfig(baseEnv());
    await purgeTestPrefix(client, remoteConfig);
});

after(async () => {
    try {
        const remoteConfig = readBackupRemoteConfig(baseEnv());
        await purgeTestPrefix(client, remoteConfig);
    } catch {
        // best-effort
    }
    await adminConnection.query(`DROP DATABASE IF EXISTS \`${TEST_DATABASE}\``);
    await adminConnection.end();
    await db.closePool(db);
    await fsPromises.rm(backupDirectory, { recursive: true, force: true });
    await fsPromises.rm(downloadDirectory, { recursive: true, force: true });
});

async function freshDir(label) {
    return fsPromises.mkdtemp(path.join(os.tmpdir(), `fittrack-remote-${label}-`));
}

// --- Preflight -------------------------------------------------------

test("preflight succeeds against the real test bucket and confirms read/write/delete access", async () => {
    const report = await runRemoteBackupPreflight({ env: baseEnv() });
    assert.equal(report.result, "ok");
    assert.equal(report.bucket, TEST_BUCKET);
    assert.equal(report.versioningStatus, "Enabled");
    assert.equal(report.readWriteDeleteVerified, true);
});

test("preflight fails closed when BACKUP_S3_REQUIRE_OBJECT_LOCK=true but the bucket does not confirm Object Lock", async () => {
    await assert.rejects(
        runRemoteBackupPreflight({ env: baseEnv({ BACKUP_S3_REQUIRE_OBJECT_LOCK: "true" }) }),
        (error) => error.code === "REMOTE_OBJECT_LOCK_REQUIRED"
    );
});

test("preflight fails closed when BACKUP_S3_REQUIRE_VERSIONING=true against a bucket without versioning enabled", async () => {
    const unversionedBucket = `fittrack-no-versioning-${crypto.randomBytes(4).toString("hex")}`;
    const env = baseEnv({ BACKUP_S3_BUCKET: unversionedBucket, BACKUP_S3_REQUIRE_VERSIONING: "true" });
    const remoteConfig = readBackupRemoteConfig({ ...env, BACKUP_S3_REQUIRE_VERSIONING: "false" });
    const plainClient = createS3Client(remoteConfig);
    await plainClient.send(new CreateBucketCommand({ Bucket: unversionedBucket }));
    try {
        await assert.rejects(
            runRemoteBackupPreflight({ env }),
            (error) => error.code === "REMOTE_VERSIONING_REQUIRED"
        );
    } finally {
        // Best-effort cleanup of the throwaway bucket used only by this test.
        try {
            await purgeTestPrefix(plainClient, { ...remoteConfig, prefix: env.BACKUP_S3_PREFIX });
        } catch {
            // ignore
        }
    }
});

// --- Upload ------------------------------------------------------------

test("uploadEncryptedBackup publishes a real backup and the report matches a post-upload HeadObject", async () => {
    const env = baseEnv();
    const createReport = await createEncryptedBackup({ env });
    const backupPath = path.join(backupDirectory, createReport.filename);

    const uploadReport = await uploadEncryptedBackup({ env: { ...env, FITTRACK_BACKUP_REMOTE_FILE: backupPath } });
    assert.equal(uploadReport.result, "ok");
    assert.equal(uploadReport.bytes, createReport.bytes);
    assert.equal(uploadReport.ciphertextSha256, createReport.ciphertextSha256);
    assert.equal(uploadReport.keyId, createReport.keyId);
    assert.match(uploadReport.key, new RegExp(`^${testPrefix}/\\d{4}/\\d{2}/${createReport.filename}$`));

    await fsPromises.rm(backupPath, { force: true });
});

test("uploadEncryptedBackup refuses to upload a locally tampered .ftbackup file and never publishes any object", async () => {
    const env = baseEnv();
    const createReport = await createEncryptedBackup({ env });
    const backupPath = path.join(backupDirectory, createReport.filename);

    // Flip a byte deep in the ciphertext region - well past the fixed
    // header - so this is a ciphertext tamper, not a header/shape error.
    const handle = await fsPromises.open(backupPath, "r+");
    await handle.write(Buffer.from([0xff]), 0, 1, 40);
    await handle.close();

    await assert.rejects(
        uploadEncryptedBackup({ env: { ...env, FITTRACK_BACKUP_REMOTE_FILE: backupPath } }),
        (error) => error.code === "BACKUP_INTEGRITY_FAILED"
    );

    const inventory = await listRemoteBackups({ env });
    assert.equal(inventory.count, 0, "a tampered local file must never reach the remote bucket");

    await fsPromises.rm(backupPath, { force: true });
});

test("uploadEncryptedBackup rejects a file that is not a .ftbackup", async () => {
    const env = baseEnv();
    const notABackup = path.join(backupDirectory, "notes.txt");
    await fsPromises.writeFile(notABackup, "hello");
    await assert.rejects(
        uploadEncryptedBackup({ env: { ...env, FITTRACK_BACKUP_REMOTE_FILE: notABackup } }),
        (error) => error.code === "BACKUP_FILE_INVALID"
    );
    await fsPromises.rm(notABackup, { force: true });
});

test("uploadEncryptedBackup refuses to overwrite an object that already exists at the computed key, and the pre-existing foreign object is left byte-for-byte unchanged", async () => {
    const env = baseEnv();
    const createReport = await createEncryptedBackup({ env });
    const backupPath = path.join(backupDirectory, createReport.filename);
    const remoteConfig = readBackupRemoteConfig(env);
    const collisionKey = `${testPrefix}/${new Date(createReport.createdAt).getUTCFullYear()}/${String(
        new Date(createReport.createdAt).getUTCMonth() + 1
    ).padStart(2, "0")}/${createReport.filename}`;

    // Publish a pre-existing, entirely unrelated ("foreign") object at the
    // exact key this upload would use, bypassing the upload command
    // entirely, to force a genuine collision.
    const foreignBody = "pre-existing-foreign-object-must-survive";
    await client.send(
        new PutObjectCommand({ Bucket: remoteConfig.bucket, Key: collisionKey, Body: Buffer.from(foreignBody) })
    );

    await assert.rejects(
        uploadEncryptedBackup({ env: { ...env, FITTRACK_BACKUP_REMOTE_FILE: backupPath } }),
        (error) => error.code === "REMOTE_OBJECT_ALREADY_EXISTS"
    );

    // The atomic conditional write must never have touched the pre-existing
    // object - not its bytes, not its metadata.
    const got = await client.send(new GetObjectCommand({ Bucket: remoteConfig.bucket, Key: collisionKey }));
    const chunks = [];
    for await (const chunk of got.Body) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(), foreignBody);

    await fsPromises.rm(backupPath, { force: true });
});

test("two genuinely concurrent uploads racing for the same object key: exactly one succeeds atomically, the loser fails stably with REMOTE_OBJECT_ALREADY_EXISTS, and the final object matches the winner byte-for-byte with no stray artifact left behind", async () => {
    const env = baseEnv();
    const createReport = await createEncryptedBackup({ env });
    const backupPath = path.join(backupDirectory, createReport.filename);
    const localBytes = await fsPromises.readFile(backupPath);
    const localSha256 = crypto.createHash("sha256").update(localBytes).digest("hex");

    // Both concurrent calls target the *same* local file, so both compute
    // the identical remote object key - this is what forces a genuine race
    // for the same key rather than two independent, naturally-distinct keys.
    const uploadEnv = { ...env, FITTRACK_BACKUP_REMOTE_FILE: backupPath };
    const results = await Promise.allSettled([
        uploadEncryptedBackup({ env: uploadEnv }),
        uploadEncryptedBackup({ env: uploadEnv })
    ]);

    const succeeded = results.filter((result) => result.status === "fulfilled");
    const failed = results.filter((result) => result.status === "rejected");
    assert.equal(succeeded.length, 1, "exactly one concurrent upload must succeed");
    assert.equal(failed.length, 1, "exactly one concurrent upload must fail");
    assert.equal(failed[0].reason.code, "REMOTE_OBJECT_ALREADY_EXISTS");

    const winnerReport = succeeded[0].value;
    assert.equal(winnerReport.ciphertextSha256, localSha256);

    const remoteConfig = readBackupRemoteConfig(env);
    const head = await headObject({ client, remoteConfig, key: winnerReport.key });
    assert.equal(head.ContentLength, localBytes.length);
    assert.equal(head.Metadata["ciphertext-sha256"], localSha256);
    assert.equal(head.Metadata["key-id"], winnerReport.keyId);

    // No stray/temporary object was left behind by the losing attempt -
    // exactly one object exists at this key.
    const inventory = await listRemoteBackups({ env });
    const matches = inventory.entries.filter((entry) => entry.key === winnerReport.key);
    assert.equal(matches.length, 1);

    await fsPromises.rm(backupPath, { force: true });
});

// --- List / inventory ---------------------------------------------------

test("listRemoteBackups paginates fully across multiple pages and reports every recognized object", async () => {
    const env = baseEnv();
    const filePaths = [];
    for (let i = 0; i < 5; i += 1) {
        const createReport = await createEncryptedBackup({ env });
        const backupPath = path.join(backupDirectory, createReport.filename);
        await uploadEncryptedBackup({ env: { ...env, FITTRACK_BACKUP_REMOTE_FILE: backupPath } });
        filePaths.push(backupPath);
    }

    const inventory = await listRemoteBackups({ env, pageSize: 2 });
    assert.equal(inventory.count, 5);
    assert.equal(inventory.truncatedForSafety, false);
    assert.ok(inventory.entries.every((entry) => entry.recognized));
    assert.ok(inventory.entries.every((entry) => entry.keyId === "remote-integration-test-key"));

    await Promise.all(filePaths.map((filePath) => fsPromises.rm(filePath, { force: true })));
});

test("listRemoteBackups flags an unrecognized object without ever removing it", async () => {
    const env = baseEnv();
    const remoteConfig = readBackupRemoteConfig(env);
    const strangeKey = `${testPrefix}/not-a-backup-shaped-object.txt`;
    await client.send(new PutObjectCommand({ Bucket: remoteConfig.bucket, Key: strangeKey, Body: Buffer.from("hello") }));

    const inventory = await listRemoteBackups({ env });
    const entry = inventory.entries.find((candidate) => candidate.key === strangeKey);
    assert.ok(entry, "the unrecognized object must still be listed");
    assert.equal(entry.recognized, false);
    assert.equal(entry.metadataAvailable, false);

    const stillThere = await listRemoteBackups({ env });
    assert.ok(stillThere.entries.some((candidate) => candidate.key === strangeKey), "the object must not have been deleted");
});

// --- Download / remote verify -------------------------------------------

async function uploadFreshBackup(env) {
    const createReport = await createEncryptedBackup({ env });
    const backupPath = path.join(backupDirectory, createReport.filename);
    const uploadReport = await uploadEncryptedBackup({ env: { ...env, FITTRACK_BACKUP_REMOTE_FILE: backupPath } });
    await fsPromises.rm(backupPath, { force: true });
    return { createReport, uploadReport };
}

test("downloadRemoteBackup fetches, verifies, and atomically publishes a local copy; verifyRemoteBackup proves the same and leaves no trace", async () => {
    const env = baseEnv();
    const { uploadReport } = await uploadFreshBackup(env);

    const dlDir = await freshDir("download");
    const downloadReport = await downloadRemoteBackup({
        env: { ...env, FITTRACK_BACKUP_REMOTE_KEY: uploadReport.key, FITTRACK_BACKUP_REMOTE_DOWNLOAD_DIR: dlDir }
    });
    assert.equal(downloadReport.result, "ok");
    assert.equal(downloadReport.ciphertextSha256, uploadReport.ciphertextSha256);
    assert.ok(fs.existsSync(downloadReport.localPath));
    assert.deepEqual(fs.readdirSync(dlDir).filter((name) => name.endsWith(".partial")), []);

    const verifyDir = await freshDir("verify");
    const verifyReport = await verifyRemoteBackup({
        env: { ...env, FITTRACK_BACKUP_REMOTE_KEY: uploadReport.key, FITTRACK_BACKUP_REMOTE_DOWNLOAD_DIR: verifyDir }
    });
    assert.equal(verifyReport.result, "ok");
    assert.equal(verifyReport.localPath, null);
    assert.deepEqual(fs.readdirSync(verifyDir), [], "verify must leave no local artifact behind, success or failure");

    await fsPromises.rm(dlDir, { recursive: true, force: true });
    await fsPromises.rm(verifyDir, { recursive: true, force: true });
});

test("downloadRemoteBackup rejects a key outside the configured prefix", async () => {
    const env = baseEnv();
    const dlDir = await freshDir("outside-prefix");
    await assert.rejects(
        downloadRemoteBackup({
            env: {
                ...env,
                FITTRACK_BACKUP_REMOTE_KEY: "some-other-prefix/2026/07/fittrack-20260722T000000Z-aaaaaaaa.ftbackup",
                FITTRACK_BACKUP_REMOTE_DOWNLOAD_DIR: dlDir
            }
        }),
        (error) => error.code === "REMOTE_OBJECT_KEY_OUTSIDE_PREFIX"
    );
    await fsPromises.rm(dlDir, { recursive: true, force: true });
});

test("downloadRemoteBackup refuses to overwrite an already-existing local target file", async () => {
    const env = baseEnv();
    const { uploadReport } = await uploadFreshBackup(env);
    const dlDir = await freshDir("existing-target");
    const filename = path.basename(uploadReport.key);
    await fsPromises.writeFile(path.join(dlDir, filename), "already here");

    await assert.rejects(
        downloadRemoteBackup({
            env: { ...env, FITTRACK_BACKUP_REMOTE_KEY: uploadReport.key, FITTRACK_BACKUP_REMOTE_DOWNLOAD_DIR: dlDir }
        }),
        (error) => error.code === "REMOTE_DOWNLOAD_TARGET_EXISTS"
    );
    await fsPromises.rm(dlDir, { recursive: true, force: true });
});

test("a remote object whose recorded ciphertext-sha256 metadata does not match its real bytes is rejected, and no .partial file is left behind", async () => {
    const env = baseEnv();
    const remoteConfig = readBackupRemoteConfig(env);
    const createReport = await createEncryptedBackup({ env });
    const backupPath = path.join(backupDirectory, createReport.filename);
    const body = await fsPromises.readFile(backupPath);
    const key = `${testPrefix}/2026/07/${createReport.filename}`;

    // Publish directly with a metadata hash that does not match the real
    // bytes - simulates manipulated remote metadata independent of the
    // object body itself.
    await client.send(
        new PutObjectCommand({
            Bucket: remoteConfig.bucket,
            Key: key,
            Body: body,
            ContentType: "application/vnd.fittrack.backup",
            Metadata: {
                "format-version": "1",
                "key-id": createReport.keyId,
                "ciphertext-sha256": "0".repeat(64),
                application: "fittrack",
                "backup-type": "encrypted-logical"
            }
        })
    );

    const dlDir = await freshDir("bad-metadata");
    await assert.rejects(
        downloadRemoteBackup({
            env: { ...env, FITTRACK_BACKUP_REMOTE_KEY: key, FITTRACK_BACKUP_REMOTE_DOWNLOAD_DIR: dlDir }
        }),
        (error) => error.code === "REMOTE_CIPHERTEXT_HASH_MISMATCH"
    );
    assert.deepEqual(fs.readdirSync(dlDir), [], "no .partial or published file may remain after a hash mismatch");

    await fsPromises.rm(backupPath, { force: true });
    await fsPromises.rm(dlDir, { recursive: true, force: true });
});

test("a remote object whose bytes were tampered (with metadata rewritten to match the tampered bytes) still fails full GCM verification", async () => {
    const env = baseEnv();
    const remoteConfig = readBackupRemoteConfig(env);
    const createReport = await createEncryptedBackup({ env });
    const backupPath = path.join(backupDirectory, createReport.filename);
    const body = Buffer.from(await fsPromises.readFile(backupPath));
    // Flip a ciphertext byte, then recompute the hash over the *tampered*
    // bytes so the ciphertext-sha256 check alone cannot catch this - only
    // the GCM authentication tag can.
    body[40] ^= 0xff;
    const tamperedSha256 = crypto.createHash("sha256").update(body).digest("hex");
    const key = `${testPrefix}/2026/07/${createReport.filename}`;

    await client.send(
        new PutObjectCommand({
            Bucket: remoteConfig.bucket,
            Key: key,
            Body: body,
            ContentType: "application/vnd.fittrack.backup",
            Metadata: {
                "format-version": "1",
                "key-id": createReport.keyId,
                "ciphertext-sha256": tamperedSha256,
                application: "fittrack",
                "backup-type": "encrypted-logical"
            }
        })
    );

    const dlDir = await freshDir("tampered-object");
    await assert.rejects(
        downloadRemoteBackup({
            env: { ...env, FITTRACK_BACKUP_REMOTE_KEY: key, FITTRACK_BACKUP_REMOTE_DOWNLOAD_DIR: dlDir }
        }),
        (error) => error.code === "BACKUP_INTEGRITY_FAILED"
    );
    assert.deepEqual(fs.readdirSync(dlDir), [], "a GCM-tampered object must leave no local artifact behind");

    await fsPromises.rm(backupPath, { force: true });
    await fsPromises.rm(dlDir, { recursive: true, force: true });
});

test("a remote backup encrypted under a different key id than the local configuration is rejected with a key-id mismatch", async () => {
    const uploadEnv = baseEnv({ BACKUP_ENCRYPTION_KEY_ID: "remote-integration-key-a" });
    const { uploadReport } = await uploadFreshBackup(uploadEnv);

    const downloadEnv = baseEnv({
        BACKUP_ENCRYPTION_KEY_B64: uploadEnv.BACKUP_ENCRYPTION_KEY_B64,
        BACKUP_ENCRYPTION_KEY_ID: "remote-integration-key-b"
    });
    const dlDir = await freshDir("wrong-key-id");
    await assert.rejects(
        downloadRemoteBackup({
            env: { ...downloadEnv, FITTRACK_BACKUP_REMOTE_KEY: uploadReport.key, FITTRACK_BACKUP_REMOTE_DOWNLOAD_DIR: dlDir }
        }),
        (error) => error.code === "BACKUP_KEY_ID_MISMATCH"
    );
    await fsPromises.rm(dlDir, { recursive: true, force: true });
});

// --- Timeouts -------------------------------------------------------
//
// A tiny timeoutMs against the real, fast local MinIO instance races the
// abort timer against genuine completion - on a loopback connection with a
// small payload, completion can occasionally win, making the test flaky.
// Instead, these point the S3 client at a throwaway local TCP server that
// accepts the connection but deliberately never responds, so the request
// genuinely hangs and only the configured timeout can ever resolve it -
// still a real socket, a real HTTP request, and a real AbortController,
// just against an endpoint built to never answer.
const net = require("node:net");
const { Writable } = require("node:stream");

async function withHangingEndpoint(run) {
    const sockets = new Set();
    const server = net.createServer((socket) => {
        sockets.add(socket);
        socket.on("error", () => {});
        socket.on("close", () => sockets.delete(socket));
        // Deliberately never write a response - the client's request stays
        // open until it is aborted.
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    try {
        const env = baseEnv({ BACKUP_S3_ENDPOINT: `http://127.0.0.1:${port}` });
        const remoteConfig = readBackupRemoteConfig(env);
        const hangingClient = createS3Client(remoteConfig);
        await run({ hangingClient, remoteConfig });
    } finally {
        // A plain server.close() only stops accepting *new* connections and
        // waits for existing ones to end on their own. The SDK's own
        // in-flight request is not actually cancelled by an abort - only
        // the outer Upload/GetObject promise rejects promptly - so its
        // socket is still open at this point, and server.close() alone
        // would hang forever. net.Server has no closeAllConnections()
        // (that only exists on http.Server), so this destroys every
        // still-open socket by hand before closing, keeping teardown bounded.
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve) => server.close(resolve));
    }
}

test("uploadObject aborts and reports a stable timeout code when the endpoint never responds", async () => {
    await withHangingEndpoint(async ({ hangingClient, remoteConfig }) => {
        const key = `${testPrefix}/2026/07/fittrack-20260722T000000Z-aaaaaaaa.ftbackup`;
        const started = Date.now();
        await assert.rejects(
            uploadObject({
                client: hangingClient,
                remoteConfig: { ...remoteConfig, uploadTimeoutMs: 300 },
                key,
                body: Buffer.alloc(1024, 1),
                contentLength: 1024,
                metadataFields: { "format-version": "1", "key-id": "k", application: "fittrack", "backup-type": "encrypted-logical" }
            }),
            (error) => error.code === "REMOTE_OPERATION_TIMEOUT"
        );
        assert.ok(Date.now() - started < 5000, "the timeout must fire close to its configured value, not hang indefinitely");
    });
});

test("downloadObjectToSink aborts and reports a stable timeout code when the endpoint never responds", async () => {
    await withHangingEndpoint(async ({ hangingClient, remoteConfig }) => {
        const sink = new Writable({ write(chunk, enc, cb) { cb(); } });
        const started = Date.now();
        await assert.rejects(
            downloadObjectToSink({
                client: hangingClient,
                remoteConfig: { ...remoteConfig, downloadTimeoutMs: 300 },
                key: `${testPrefix}/2026/07/fittrack-20260722T000000Z-aaaaaaaa.ftbackup`,
                sink
            }),
            (error) => error.code === "REMOTE_OPERATION_TIMEOUT"
        );
        assert.ok(Date.now() - started < 5000, "the timeout must fire close to its configured value, not hang indefinitely");
    });
});

// --- Full remote restore drill -------------------------------------------

test("runRemoteRestoreDrill performs a genuine create -> upload -> download -> restore -> Migration Doctor round trip and cleans up completely", async () => {
    const env = baseEnv();
    const report = await runRemoteRestoreDrill({ env });

    assert.equal(report.result, "ok");
    assert.equal(report.migrationDoctor.state, "ready");
    assert.ok(report.tablesCompared > 0);
    assert.equal(report.backup.ciphertextSha256, report.remoteVerify.ciphertextSha256);

    // Restore target database was dropped.
    const [rows] = await adminConnection.query(
        "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
        [report.targetDatabase]
    );
    assert.equal(rows.length, 0, "restore target database must be dropped after the drill");

    // Local artifacts (original + downloaded copy) were removed.
    const remainingLocalFiles = (await fsPromises.readdir(backupDirectory)).filter((name) =>
        name.endsWith(".ftbackup")
    );
    assert.deepEqual(remainingLocalFiles, [], "no local backup artifact should remain after the drill");

    // Remote test object was removed.
    const inventory = await listRemoteBackups({ env });
    assert.equal(
        inventory.entries.some((entry) => entry.key === report.remoteKey),
        false,
        "the remote drill's test object must be deleted afterward"
    );
});

// --- Retention ------------------------------------------------------

test("planRemoteRetention is a pure dry run that never deletes anything and skips unrecognized objects", async () => {
    const env = baseEnv();
    const remoteConfig = readBackupRemoteConfig(env);
    const strangeKey = `${testPrefix}/unexpected-file.bin`;
    await client.send(new PutObjectCommand({ Bucket: remoteConfig.bucket, Key: strangeKey, Body: Buffer.from("x") }));

    const filePaths = [];
    for (let i = 0; i < 3; i += 1) {
        const createReport = await createEncryptedBackup({ env });
        const backupPath = path.join(backupDirectory, createReport.filename);
        await uploadEncryptedBackup({ env: { ...env, FITTRACK_BACKUP_REMOTE_FILE: backupPath } });
        filePaths.push(backupPath);
    }

    const plan = await planRemoteRetention({ env });
    assert.equal(plan.dryRun, true);
    assert.equal(plan.unrecognizedObjectsSkipped, 1);
    assert.equal(plan.keep.length + plan.remove.length, 3);

    const inventoryAfterPlan = await listRemoteBackups({ env });
    assert.equal(inventoryAfterPlan.count, 4, "planning must not delete anything, recognized or not");

    await Promise.all(filePaths.map((filePath) => fsPromises.rm(filePath, { force: true })));
});

test("applyRemoteRetention deletes only the planned, recognized objects and never touches an unrecognized object", async () => {
    const env = baseEnv();
    const remoteConfig = readBackupRemoteConfig(env);
    const strangeKey = `${testPrefix}/unexpected-file-2.bin`;
    await client.send(new PutObjectCommand({ Bucket: remoteConfig.bucket, Key: strangeKey, Body: Buffer.from("x") }));

    // Use a low daily/weekly/monthly footprint: two uploads guarantee at
    // least the older one is a removal candidate relative to the newest.
    const filePaths = [];
    for (let i = 0; i < 2; i += 1) {
        const createReport = await createEncryptedBackup({ env });
        const backupPath = path.join(backupDirectory, createReport.filename);
        await uploadEncryptedBackup({ env: { ...env, FITTRACK_BACKUP_REMOTE_FILE: backupPath } });
        filePaths.push(backupPath);
        // Ensure distinct completedAt values so bucket selection is deterministic.
        await new Promise((resolve) => setTimeout(resolve, 1100));
    }

    const plan = await planRemoteRetention({ env });
    const applyEnv = {
        ...env,
        BACKUP_REMOTE_RETENTION_APPLY: "true",
        FITTRACK_REMOTE_RETENTION_BUCKET_ACK: remoteConfig.bucket,
        FITTRACK_REMOTE_RETENTION_PREFIX_ACK: remoteConfig.prefix,
        FITTRACK_REMOTE_RETENTION_MAX_DELETE: String(plan.remove.length)
    };
    const applyReport = await applyRemoteRetention({ env: applyEnv });
    assert.equal(applyReport.deletedCount, plan.remove.length);

    const inventoryAfter = await listRemoteBackups({ env });
    assert.equal(
        inventoryAfter.entries.some((entry) => entry.key === strangeKey),
        true,
        "an unrecognized object must survive a retention apply run"
    );
    for (const removedKey of plan.remove) {
        assert.equal(inventoryAfter.entries.some((entry) => entry.key === removedKey), false);
    }

    await Promise.all(filePaths.map((filePath) => fsPromises.rm(filePath, { force: true })));
});

test("applyRemoteRetention refuses to exceed the authorized maximum deletion count and deletes nothing", async () => {
    const env = baseEnv();
    const remoteConfig = readBackupRemoteConfig(env);
    const filePaths = [];
    for (let i = 0; i < 2; i += 1) {
        const createReport = await createEncryptedBackup({ env });
        const backupPath = path.join(backupDirectory, createReport.filename);
        await uploadEncryptedBackup({ env: { ...env, FITTRACK_BACKUP_REMOTE_FILE: backupPath } });
        filePaths.push(backupPath);
        await new Promise((resolve) => setTimeout(resolve, 1100));
    }
    const beforeInventory = await listRemoteBackups({ env });

    await assert.rejects(
        applyRemoteRetention({
            env: {
                ...env,
                BACKUP_REMOTE_RETENTION_APPLY: "true",
                FITTRACK_REMOTE_RETENTION_BUCKET_ACK: remoteConfig.bucket,
                FITTRACK_REMOTE_RETENTION_PREFIX_ACK: remoteConfig.prefix,
                FITTRACK_REMOTE_RETENTION_MAX_DELETE: "0"
            }
        }),
        (error) => error.code === "REMOTE_RETENTION_NOT_AUTHORIZED"
    );

    const afterInventory = await listRemoteBackups({ env });
    assert.equal(afterInventory.count, beforeInventory.count, "a refused retention apply must delete nothing at all");

    await Promise.all(filePaths.map((filePath) => fsPromises.rm(filePath, { force: true })));
});
