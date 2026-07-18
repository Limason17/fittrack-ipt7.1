const mysql = require("mysql2");
require("dotenv").config({ quiet: true });

function configError(message) {
    const error = new Error(message);
    error.code = "INVALID_DATABASE_CONFIG";
    return error;
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
    const promisePool = promiseClient(client);
    if (typeof promisePool.end === "function") {
        await promisePool.end();
    }
}

function createAdminConnection(config = readDatabaseConfig(process.env, { includeDatabase: false })) {
    return mysql.createConnection(config).promise();
}

const db = createPool();

module.exports = db;
module.exports.closePool = closePool;
module.exports.configError = configError;
module.exports.createAdminConnection = createAdminConnection;
module.exports.createPool = createPool;
module.exports.integerSetting = integerSetting;
module.exports.promiseClient = promiseClient;
module.exports.readDatabaseConfig = readDatabaseConfig;
module.exports.textSetting = textSetting;
module.exports.verifyConnection = verifyConnection;
