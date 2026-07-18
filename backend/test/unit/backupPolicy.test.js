const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const {
    applyBackupRetention,
    assertAutomatedBackupEnvironment,
    checkBackupStatus,
    safeBackupFailure
} = require("../../scripts/databaseBackupPolicy");
const { createBackupFilename } = require("../../scripts/databaseTools");
const {
    createBackupFixture,
    createBackupWorkspace,
    statusEnvironment
} = require("./backupTestSupport");

test("automated backups require an explicit database, acknowledgement and safe target", async (t) => {
    const { repositoryRoot, backupDirectory } = await createBackupWorkspace(t);
    const env = {
        ...statusEnvironment(backupDirectory),
        DB_HOST: "127.0.0.1",
        DB_USER: "backup_user",
        DB_PASSWORD: "not-logged",
        FITTRACK_DB_CONTAINER: "fittrack_mysql"
    };
    const config = {
        host: env.DB_HOST,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        database: env.DB_NAME
    };

    assert.equal(
        assertAutomatedBackupEnvironment(env, config, repositoryRoot).database,
        "fittrack"
    );
    for (const changed of [
        { FITTRACK_BACKUP_EXPECTED_DATABASE: "fittrack_other" },
        { FITTRACK_BACKUP_ACK: "yes" },
        { FITTRACK_BACKUP_DIR: "relative-backups" },
        { DB_HOST: "db.internal.example" },
        { FITTRACK_DB_CONTAINER: "" }
    ]) {
        const candidate = { ...env, ...changed };
        const candidateConfig = { ...config, host: candidate.DB_HOST };
        assert.throws(
            () => assertAutomatedBackupEnvironment(candidate, candidateConfig, repositoryRoot),
            (error) => /^BACKUP_|^DATABASE_TOOL_/.test(error.code)
        );
    }
});

test("backup status verifies hash and changes to stale only after 24 hours", async (t) => {
    const { repositoryRoot, backupDirectory } = await createBackupWorkspace(t);
    const completedAt = new Date("2026-07-17T00:00:00.000Z");
    const fixture = await createBackupFixture({ backupDirectory, createdAt: completedAt });
    const env = statusEnvironment(backupDirectory);

    const boundary = await checkBackupStatus({
        env,
        repositoryRoot,
        now: new Date("2026-07-18T00:00:00.000Z")
    });
    assert.equal(boundary.code, "BACKUP_OK");
    assert.equal(boundary.exitCode, 0);
    assert.equal(boundary.latest.ageSeconds, 86400);

    const stale = await checkBackupStatus({
        env,
        repositoryRoot,
        now: new Date("2026-07-18T00:00:00.001Z")
    });
    assert.equal(stale.code, "BACKUP_STALE");
    assert.equal(stale.exitCode, 22);

    await fsPromises.appendFile(fixture.artifactPath, "tampered");
    await assert.rejects(
        checkBackupStatus({ env, repositoryRoot, now: completedAt }),
        (error) => error.code === "BACKUP_INTEGRITY_FAILED"
    );
});

test("backup status reports missing inventory without reading unknown files", async (t) => {
    const { repositoryRoot, backupDirectory } = await createBackupWorkspace(t);
    await fsPromises.writeFile(path.join(backupDirectory, "legacy.sql"), "secret dump content");
    await assert.rejects(
        checkBackupStatus({
            env: statusEnvironment(backupDirectory),
            repositoryRoot,
            now: new Date("2026-07-18T00:00:00.000Z")
        }),
        (error) => error.code === "BACKUP_MISSING"
    );
});

test("a managed manifest without its artifact is an integrity failure", async (t) => {
    const { repositoryRoot, backupDirectory } = await createBackupWorkspace(t);
    const fixture = await createBackupFixture({
        backupDirectory,
        createdAt: new Date("2026-07-18T00:00:00.000Z")
    });
    await fsPromises.rm(fixture.artifactPath);

    await assert.rejects(
        checkBackupStatus({
            env: statusEnvironment(backupDirectory),
            repositoryRoot,
            now: new Date("2026-07-18T01:00:00.000Z")
        }),
        (error) => error.code === "BACKUP_INTEGRITY_FAILED"
    );
});

test("UTC GFS retention keeps 7 daily, 4 weekly and 3 monthly generations", async (t) => {
    const { backupDirectory } = await createBackupWorkspace(t);
    const dates = [
        "2026-03-10T02:00:00.000Z",
        "2026-03-09T02:00:00.000Z",
        "2026-03-08T02:00:00.000Z",
        "2026-03-07T02:00:00.000Z",
        "2026-03-06T02:00:00.000Z",
        "2026-03-05T02:00:00.000Z",
        "2026-03-04T02:00:00.000Z",
        "2026-02-28T02:00:00.000Z",
        "2026-02-21T02:00:00.000Z",
        "2026-02-14T02:00:00.000Z",
        "2026-01-31T02:00:00.000Z",
        "2025-12-31T02:00:00.000Z"
    ].map((value) => new Date(value));
    for (const date of dates) {
        await createBackupFixture({ backupDirectory, createdAt: date });
    }
    const legacyPath = path.join(backupDirectory, "fittrack-legacy.sql");
    const unknownPath = path.join(backupDirectory, "fittrack-unmanaged.sql.gz");
    const otherManifest = path.join(
        backupDirectory,
        "otherdb-20200101T000000Z.sql.gz.manifest.json"
    );
    await fsPromises.writeFile(legacyPath, "legacy-secret-data");
    await fsPromises.writeFile(unknownPath, "unknown-secret-data");
    await fsPromises.writeFile(otherManifest, "not-json");

    const result = await applyBackupRetention({ backupDirectory, database: "fittrack" });
    assert.deepEqual(result.policy, { daily: 7, weekly: 4, monthly: 3 });
    assert.equal(result.kept, 10);
    assert.equal(result.removed, 2);

    for (const value of ["2026-02-14T02:00:00.000Z", "2025-12-31T02:00:00.000Z"]) {
        const artifact = path.join(
            backupDirectory,
            `${createBackupFilename("fittrack", new Date(value))}.gz`
        );
        await assert.rejects(fsPromises.access(artifact), (error) => error.code === "ENOENT");
        await assert.rejects(
            fsPromises.access(`${artifact}.manifest.json`),
            (error) => error.code === "ENOENT"
        );
    }
    assert.equal(await fsPromises.readFile(legacyPath, "utf8"), "legacy-secret-data");
    assert.equal(await fsPromises.readFile(unknownPath, "utf8"), "unknown-secret-data");
    assert.equal(await fsPromises.readFile(otherManifest, "utf8"), "not-json");
});

test("machine-readable backup failures never echo arbitrary error details", () => {
    const secret = "ultra-private-password";
    const error = new Error(`mysqldump failed password=${secret}`);
    error.code = "DATABASE_TOOL_FAILED";
    error.toolMessage = `MYSQL_PWD=${secret}`;
    const report = safeBackupFailure(
        error,
        "database_backup_failed",
        new Date("2026-07-18T00:00:00.000Z")
    );
    assert.equal(report.exitCode, 20);
    assert.equal(JSON.stringify(report).includes(secret), false);
    assert.deepEqual(Object.keys(report), [
        "schemaVersion",
        "event",
        "status",
        "code",
        "exitCode",
        "timestamp"
    ]);

    const untrustedCode = new Error("failed");
    untrustedCode.code = "PASSWORD_ULTRA_PRIVATE";
    assert.equal(
        safeBackupFailure(untrustedCode, "database_backup_failed").code,
        "BACKUP_FAILED"
    );
});
