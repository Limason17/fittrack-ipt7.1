const mysql = require("mysql2");
const path = require("node:path");
const dotenv = require("dotenv");

const BACKEND_ENV_PATH = path.resolve(__dirname, "../.env");
let backendEnvironmentLoaded = false;
let defaultPool;

const RUNTIME_ENVIRONMENTS = new Set(["development", "test", "production"]);

function configError(message) {
    const error = new Error(message);
    error.code = "INVALID_DATABASE_CONFIG";
    return error;
}

function runtimeConfigError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function loadBackendEnvironment(env = process.env) {
    if (env === process.env && !backendEnvironmentLoaded) {
        dotenv.config({
            path: BACKEND_ENV_PATH,
            processEnv: env,
            quiet: true
        });
        backendEnvironmentLoaded = true;
    }
    return env;
}

function readRuntimeEnvironment(env = process.env) {
    loadBackendEnvironment(env);
    const environment = env.NODE_ENV;
    if (!RUNTIME_ENVIRONMENTS.has(environment)) {
        throw runtimeConfigError(
            "INVALID_RUNTIME_ENVIRONMENT",
            "NODE_ENV must be explicitly set to development, test, or production."
        );
    }
    return environment;
}

function readAutoMigrate(env = process.env) {
    loadBackendEnvironment(env);
    const value = env.FITTRACK_AUTO_MIGRATE;
    if (value === undefined || value === null || value === "" || value === "false") {
        return false;
    }
    if (value === "true") {
        return true;
    }
    throw runtimeConfigError(
        "INVALID_AUTO_MIGRATE_CONFIG",
        "FITTRACK_AUTO_MIGRATE must be exactly true or false."
    );
}

function integerSetting(value, fallback, name, { min = 1, max = 65535 } = {}) {
    if (value === undefined || value === null || value === "") {
        return fallback;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        throw configError(`${name} must be an integer between ${min} and ${max}.`);
    }

    return parsed;
}

function textSetting(env, name, fallback, { productionRequired = true } = {}) {
    const value = env[name];
    if (value === undefined || value === null || value === "") {
        if (env.NODE_ENV === "production" && productionRequired) {
            throw configError(`${name} must be configured in production.`);
        }
        return fallback;
    }
    if (typeof value !== "string" || value.length > 255) {
        throw configError(`${name} must be a non-empty string of at most 255 characters.`);
    }
    return value;
}

function readDatabaseConfig(env = process.env, { includeDatabase = true } = {}) {
    loadBackendEnvironment(env);
    const database = textSetting(env, "DB_NAME", "fittrack");

    if (!/^[A-Za-z0-9_$-]+$/.test(database)) {
        throw configError("DB_NAME contains unsupported characters.");
    }

    const config = {
        host: textSetting(env, "DB_HOST", "localhost"),
        user: textSetting(env, "DB_USER", "root"),
        password: textSetting(env, "DB_PASSWORD", "root"),
        port: integerSetting(env.DB_PORT, 3306, "DB_PORT"),
        charset: "utf8mb4",
        connectTimeout: integerSetting(env.DB_CONNECT_TIMEOUT_MS, 10000, "DB_CONNECT_TIMEOUT_MS", {
            min: 100,
            max: 120000
        })
    };

    if (includeDatabase) {
        config.database = database;
    }

    return config;
}

function assertMigrationExpectedDatabase(config, env = process.env) {
    loadBackendEnvironment(env);
    const configuredDatabase = typeof env.DB_NAME === "string" ? env.DB_NAME.trim() : "";
    const expectedDatabase =
        typeof env.FITTRACK_MIGRATION_EXPECTED_DATABASE === "string"
            ? env.FITTRACK_MIGRATION_EXPECTED_DATABASE.trim()
            : "";

    if (
        !configuredDatabase ||
        !expectedDatabase ||
        configuredDatabase !== config?.database ||
        expectedDatabase !== configuredDatabase
    ) {
        throw runtimeConfigError(
            "MIGRATION_TARGET_NOT_CONFIRMED",
            "FITTRACK_MIGRATION_EXPECTED_DATABASE must exactly match the explicit DB_NAME before migrations may modify a database."
        );
    }

    return expectedDatabase;
}

function databaseTarget(config, environment) {
    return {
        environment,
        host: config.host,
        port: config.port,
        database: config.database
    };
}

function createPool(config = readDatabaseConfig()) {
    return mysql.createPool({
        ...config,
        waitForConnections: true,
        connectionLimit: integerSetting(
            process.env.DB_CONNECTION_LIMIT,
            10,
            "DB_CONNECTION_LIMIT",
            { min: 1, max: 100 }
        ),
        queueLimit: integerSetting(process.env.DB_QUEUE_LIMIT, 100, "DB_QUEUE_LIMIT", {
            min: 0,
            max: 100000
        })
    });
}

function promiseClient(client) {
    return typeof client.promise === "function" ? client.promise() : client;
}

async function verifyConnection(client = db) {
    await promiseClient(client).query("SELECT 1 AS ok");
}

async function closePool(client = db) {
    if (client === db && !defaultPool) {
        return;
    }
    if (client === db) {
        client = defaultPool;
    }
    const promisePool = promiseClient(client);
    if (typeof promisePool.end === "function") {
        await promisePool.end();
    }
}

function createAdminConnection(config = readDatabaseConfig(process.env, { includeDatabase: false })) {
    return mysql.createConnection(config).promise();
}

function getDefaultPool() {
    if (!defaultPool) {
        defaultPool = createPool();
    }
    return defaultPool;
}

const db = {
    promise() {
        return getDefaultPool().promise();
    },
    query(...args) {
        return getDefaultPool().query(...args);
    }
};

module.exports = db;
module.exports.BACKEND_ENV_PATH = BACKEND_ENV_PATH;
module.exports.assertMigrationExpectedDatabase = assertMigrationExpectedDatabase;
module.exports.closePool = closePool;
module.exports.configError = configError;
module.exports.createAdminConnection = createAdminConnection;
module.exports.createPool = createPool;
module.exports.databaseTarget = databaseTarget;
module.exports.integerSetting = integerSetting;
module.exports.loadBackendEnvironment = loadBackendEnvironment;
module.exports.promiseClient = promiseClient;
module.exports.readAutoMigrate = readAutoMigrate;
module.exports.readDatabaseConfig = readDatabaseConfig;
module.exports.readRuntimeEnvironment = readRuntimeEnvironment;
module.exports.runtimeConfigError = runtimeConfigError;
module.exports.textSetting = textSetting;
module.exports.verifyConnection = verifyConnection;
