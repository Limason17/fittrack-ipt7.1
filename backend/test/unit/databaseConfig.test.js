const test = require("node:test");
const assert = require("node:assert/strict");

const { readDatabaseConfig } = require("../../config/db");

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

