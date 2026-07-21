const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const {
    assertMatchingDatabaseIdentities,
    createDailyBackup,
    readContainerDatabaseIdentity
} = require("../../scripts/dbBackupDaily");
const { createBackup } = require("../../scripts/dbBackup");
const {
    prepareRestoreSource,
    restoreBackup
} = require("../../scripts/dbRestore");
const {
    createBackupFilename,
    verifyLogicalBackupFile
} = require("../../scripts/databaseTools");
const {
    SERVER_UUID,
    createBackupFixture,
    createBackupWorkspace,
    logicalDump,
    statusEnvironment
} = require("./backupTestSupport");

function automationEnvironment(backupDirectory, database = "fittrack") {
    return {
        ...statusEnvironment(backupDirectory, database),
        DB_HOST: "127.0.0.1",
        DB_PORT: "3306",
        DB_USER: "backup_user",
        DB_PASSWORD: "private-database-password",
        FITTRACK_DB_CONTAINER: "fittrack_mysql",
        // This legacy path now requires explicit opt-in (never in
        // production) - see databaseSafety.js#assertLegacyUnencryptedBackupAllowed.
        // These tests intentionally exercise the still-supported legacy
        // behavior itself, not the new gate, so they opt in explicitly.
        ALLOW_LEGACY_UNENCRYPTED_BACKUP: "true"
    };
}

test("database identity check rejects a different host/container MySQL instance", () => {
    assert.deepEqual(
        assertMatchingDatabaseIdentities({
            configured: { database: "fittrack", serverUuid: SERVER_UUID },
            container: { database: "fittrack", serverUuid: SERVER_UUID },
            expectedDatabase: "fittrack"
        }),
        { database: "fittrack", serverUuid: SERVER_UUID }
    );
    assert.throws(
        () => assertMatchingDatabaseIdentities({
            configured: { database: "fittrack", serverUuid: SERVER_UUID },
            container: {
                database: "fittrack",
                serverUuid: "22222222-2222-2222-2222-222222222222"
            },
            expectedDatabase: "fittrack"
        }),
        (error) => error.code === "BACKUP_TARGET_MISMATCH"
    );
});

test("container identity query captures metadata without putting the password in arguments", async () => {
    let invocation;
    const config = {
        database: "fittrack",
        user: "backup_user",
        password: "private-database-password"
    };
    const identity = await readContainerDatabaseIdentity(
        config,
        "fittrack_mysql",
        async (options) => {
            invocation = options;
            return `fittrack\t${SERVER_UUID}\n`;
        }
    );
    assert.deepEqual(identity, { database: "fittrack", serverUuid: SERVER_UUID });
    assert.equal(invocation.captureOutput, true);
    assert.equal(JSON.stringify(invocation.toolArgs).includes(config.password), false);
});

test("daily backup publishes only gzip plus atomic manifest and removes raw/partial files", async (t) => {
    const { repositoryRoot, backupDirectory } = await createBackupWorkspace(t);
    const env = automationEnvironment(backupDirectory);
    const now = new Date("2026-07-18T02:00:00.000Z");
    const config = {
        host: env.DB_HOST,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        database: env.DB_NAME
    };
    let rawCreated = false;
    const report = await createDailyBackup({
        env,
        now,
        repositoryRoot,
        dependencies: {
            readDatabaseConfig: () => config,
            readConfiguredIdentity: async () => ({
                database: "fittrack",
                serverUuid: SERVER_UUID
            }),
            readContainerIdentity: async () => ({
                database: "fittrack",
                serverUuid: SERVER_UUID
            }),
            createRawBackup: async () => {
                rawCreated = true;
                const rawPath = path.join(
                    backupDirectory,
                    createBackupFilename("fittrack", now)
                );
                await fsPromises.writeFile(rawPath, logicalDump("daily"), { mode: 0o600 });
                return { path: rawPath, ...(await verifyLogicalBackupFile(rawPath)) };
            },
            clock: () => new Date("2026-07-18T02:00:01.000Z")
        }
    });

    assert.equal(rawCreated, true);
    assert.equal(report.code, "BACKUP_CREATED");
    assert.equal(report.sourceIdentityVerified, true);
    assert.equal(JSON.stringify(report).includes(env.DB_PASSWORD), false);
    assert.deepEqual((await fsPromises.readdir(backupDirectory)).sort(), [
        "fittrack-20260718T020000Z.sql.gz",
        "fittrack-20260718T020000Z.sql.gz.manifest.json"
    ]);
});

test("daily backup checks target identity before creating a dump", async (t) => {
    const { repositoryRoot, backupDirectory } = await createBackupWorkspace(t);
    const env = automationEnvironment(backupDirectory);
    let rawCreated = false;
    await assert.rejects(
        createDailyBackup({
            env,
            now: new Date("2026-07-18T02:00:00.000Z"),
            repositoryRoot,
            dependencies: {
                readDatabaseConfig: () => ({
                    host: env.DB_HOST,
                    user: env.DB_USER,
                    password: env.DB_PASSWORD,
                    database: env.DB_NAME
                }),
                readConfiguredIdentity: async () => ({
                    database: "fittrack",
                    serverUuid: SERVER_UUID
                }),
                readContainerIdentity: async () => ({
                    database: "fittrack",
                    serverUuid: "22222222-2222-2222-2222-222222222222"
                }),
                createRawBackup: async () => {
                    rawCreated = true;
                }
            }
        }),
        (error) => error.code === "BACKUP_TARGET_MISMATCH"
    );
    assert.equal(rawCreated, false);
    assert.deepEqual(await fsPromises.readdir(backupDirectory), []);
});

test("compressed restore verifies manifest and expanded dump", async (t) => {
    const { backupDirectory } = await createBackupWorkspace(t);
    const fixture = await createBackupFixture({
        backupDirectory,
        createdAt: new Date("2026-07-18T02:00:00.000Z")
    });
    const source = await prepareRestoreSource(fixture.artifactPath);
    assert.equal(source.compressed, true);
    assert.equal(source.sourceSha256, fixture.manifest.artifact.sha256);
    assert.equal(source.logicalSha256, fixture.manifest.logicalDump.sha256);
    assert.equal(source.inputTransforms.length, 1);
});

test("tampered gzip is rejected before restore can drop its target database", async (t) => {
    const { backupDirectory } = await createBackupWorkspace(t);
    const fixture = await createBackupFixture({
        backupDirectory,
        createdAt: new Date("2026-07-18T02:00:00.000Z")
    });
    await fsPromises.appendFile(fixture.artifactPath, "tampered");
    let recreated = false;
    const env = {
        NODE_ENV: "test",
        ALLOW_TEST_DB_RESET: "true",
        FITTRACK_RESTORE_ACK: "restore-local-test-database",
        FITTRACK_RESTORE_FILE: fixture.artifactPath,
        DB_HOST: "127.0.0.1",
        DB_NAME: "fittrack_restore_backup_test"
    };
    await assert.rejects(
        restoreBackup({
            env,
            dependencies: {
                readDatabaseConfig: () => ({
                    host: "127.0.0.1",
                    database: "fittrack_restore_backup_test",
                    user: "root",
                    password: "private-database-password"
                }),
                recreateDatabase: async () => {
                    recreated = true;
                }
            }
        }),
        (error) => error.code === "BACKUP_INTEGRITY_FAILED"
    );
    assert.equal(recreated, false);
});

test("the legacy unencrypted backup path is forbidden in production, with no override, and creates no file first", async (t) => {
    const { repositoryRoot, backupDirectory } = await createBackupWorkspace(t);
    const env = {
        ...automationEnvironment(backupDirectory),
        NODE_ENV: "production",
        // Even an explicit opt-in must not help in production.
        ALLOW_LEGACY_UNENCRYPTED_BACKUP: "true"
    };
    let rawCreated = false;
    await assert.rejects(
        createDailyBackup({
            env,
            now: new Date("2026-07-18T02:00:00.000Z"),
            repositoryRoot,
            dependencies: {
                readDatabaseConfig: () => ({
                    host: env.DB_HOST,
                    user: env.DB_USER,
                    password: env.DB_PASSWORD,
                    database: env.DB_NAME
                }),
                createRawBackup: async () => {
                    rawCreated = true;
                }
            }
        }),
        (error) => error.code === "LEGACY_UNENCRYPTED_BACKUP_FORBIDDEN"
    );
    assert.equal(rawCreated, false, "no dump attempt may start once production is detected");
    assert.deepEqual(
        await fsPromises.readdir(backupDirectory),
        [],
        "no lock file, directory entry or artifact may exist after a forbidden legacy run"
    );
});

test("the legacy unencrypted backup path is off by default outside production too, and creates no file first", async (t) => {
    const { repositoryRoot, backupDirectory } = await createBackupWorkspace(t);
    const env = { ...automationEnvironment(backupDirectory) };
    delete env.ALLOW_LEGACY_UNENCRYPTED_BACKUP;
    let rawCreated = false;
    await assert.rejects(
        createDailyBackup({
            env,
            now: new Date("2026-07-18T02:00:00.000Z"),
            repositoryRoot,
            dependencies: {
                readDatabaseConfig: () => ({
                    host: env.DB_HOST,
                    user: env.DB_USER,
                    password: env.DB_PASSWORD,
                    database: env.DB_NAME
                }),
                createRawBackup: async () => {
                    rawCreated = true;
                }
            }
        }),
        (error) => error.code === "LEGACY_UNENCRYPTED_BACKUP_FORBIDDEN"
    );
    assert.equal(rawCreated, false);
    assert.deepEqual(await fsPromises.readdir(backupDirectory), []);
});

test("the legacy manual backup command (dbBackup.js) is also forbidden in production before any Docker call", async (t) => {
    const { backupDirectory } = await createBackupWorkspace(t);
    const env = {
        NODE_ENV: "production",
        ALLOW_LEGACY_UNENCRYPTED_BACKUP: "true",
        DB_HOST: "127.0.0.1",
        DB_NAME: "fittrack",
        DB_USER: "root",
        DB_PASSWORD: "root",
        FITTRACK_BACKUP_DIR: backupDirectory,
        FITTRACK_DB_CONTAINER: "fittrack_container_that_must_never_be_reached"
    };
    await assert.rejects(
        createBackup({ env }),
        (error) => error.code === "LEGACY_UNENCRYPTED_BACKUP_FORBIDDEN"
    );
    assert.deepEqual(await fsPromises.readdir(backupDirectory), []);
});

test("legacy uncompressed logical backups remain restore-compatible", async (t) => {
    const { backupDirectory } = await createBackupWorkspace(t);
    const filename = path.join(backupDirectory, "legacy.sql");
    await fsPromises.writeFile(filename, logicalDump("legacy"));
    const source = await prepareRestoreSource(filename);
    assert.equal(source.compressed, false);
    assert.equal(source.sourceSha256, source.logicalSha256);
    assert.deepEqual(source.inputTransforms, []);
});
