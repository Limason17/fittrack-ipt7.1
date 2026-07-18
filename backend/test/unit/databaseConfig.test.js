const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
    BACKEND_ENV_PATH,
    assertMigrationExpectedDatabase,
    databaseTarget,
    readAutoMigrate,
    readDatabaseConfig,
    readRuntimeEnvironment
} = require("../../config/db");

test("production database settings must be explicit", () => {
    assert.throws(
        () => readDatabaseConfig({ NODE_ENV: "production" }),
        (error) => error.code === "INVALID_DATABASE_CONFIG"
    );
});
test("database names and numeric settings are validated", () => {
    assert.throws(
        () => readDatabaseConfig({ DB_NAME: "fittrack;DROP", DB_PORT: "3306" }),
        (error) => error.code === "INVALID_DATABASE_CONFIG"
    );
    assert.throws(
        () => readDatabaseConfig({ DB_NAME: "fittrack", DB_PORT: "not-a-port" }),
        (error) => error.code === "INVALID_DATABASE_CONFIG"
    );
});

test("development defaults remain reproducible", () => {
    const config = readDatabaseConfig({ NODE_ENV: "development" });
    assert.equal(config.database, "fittrack");
    assert.equal(config.host, "localhost");
    assert.equal(config.port, 3306);
});

test("real runtime environments and auto-migrate values are explicit", () => {
    for (const environment of ["development", "test", "production"]) {
        assert.equal(readRuntimeEnvironment({ NODE_ENV: environment }), environment);
    }
    for (const value of [undefined, "", "false"]) {
        assert.equal(readAutoMigrate({ FITTRACK_AUTO_MIGRATE: value }), false);
    }
    assert.equal(readAutoMigrate({ FITTRACK_AUTO_MIGRATE: "true" }), true);

    for (const value of [undefined, "", "dev", "Production", "staging"]) {
        assert.throws(
            () => readRuntimeEnvironment({ NODE_ENV: value }),
            (error) => error.code === "INVALID_RUNTIME_ENVIRONMENT"
        );
    }
    assert.throws(
        () => readAutoMigrate({ FITTRACK_AUTO_MIGRATE: "yes" }),
        (error) => error.code === "INVALID_AUTO_MIGRATE_CONFIG"
    );
});

test("mutating migration targets require an exact explicit database acknowledgement", () => {
    const config = readDatabaseConfig({
        NODE_ENV: "development",
        DB_HOST: "127.0.0.1",
        DB_PORT: "3306",
        DB_NAME: "fittrack",
        DB_USER: "root",
        DB_PASSWORD: "local"
    });

    assert.equal(
        assertMigrationExpectedDatabase(config, {
            DB_NAME: "fittrack",
            FITTRACK_MIGRATION_EXPECTED_DATABASE: "fittrack"
        }),
        "fittrack"
    );

    for (const env of [
        { DB_NAME: "fittrack" },
        { FITTRACK_MIGRATION_EXPECTED_DATABASE: "fittrack" },
        { DB_NAME: "fittrack", FITTRACK_MIGRATION_EXPECTED_DATABASE: "fittrack_other" }
    ]) {
        assert.throws(
            () => assertMigrationExpectedDatabase(config, env),
            (error) => error.code === "MIGRATION_TARGET_NOT_CONFIRMED"
        );
    }
});

test("safe database target metadata never includes credentials", () => {
    const target = databaseTarget(
        {
            host: "db.internal",
            port: 3307,
            database: "fittrack_prod",
            user: "migration-user",
            password: "must-not-leak"
        },
        "production"
    );

    assert.deepEqual(target, {
        environment: "production",
        host: "db.internal",
        port: 3307,
        database: "fittrack_prod"
    });
    assert.doesNotMatch(JSON.stringify(target), /migration-user|must-not-leak/);
});

test("dotenv resolution is anchored to backend/.env and ignores the process cwd", () => {
    const backendRoot = path.resolve(__dirname, "../..");
    assert.equal(BACKEND_ENV_PATH, path.join(backendRoot, ".env"));

    const temporaryCwd = fs.mkdtempSync(path.join(os.tmpdir(), "fittrack-cwd-env-"));
    try {
        fs.writeFileSync(path.join(temporaryCwd, ".env"), "DB_NAME=wrong_cwd_database\n");
        const childEnvironment = { ...process.env };
        delete childEnvironment.DB_NAME;
        const modulePath = path.join(backendRoot, "config", "db.js");
        const source = [
            `const db = require(${JSON.stringify(modulePath)});`,
            "const config = db.readDatabaseConfig();",
            "process.stdout.write(config.database);",
            "db.closePool(db);"
        ].join("");
        const result = spawnSync(process.execPath, ["-e", source], {
            cwd: temporaryCwd,
            env: childEnvironment,
            encoding: "utf8",
            windowsHide: true
        });

        assert.equal(result.status, 0, result.stderr);
        assert.notEqual(result.stdout, "wrong_cwd_database");
    } finally {
        fs.rmSync(temporaryCwd, { recursive: true, force: true });
    }
});
