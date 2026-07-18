const db = require("../config/db");
const {
    DOCTOR_EXIT_CODES,
    createMigrationDoctor,
    doctorError
} = require("../migrations/doctor");
const { createStructuredLogger } = require("../startup/logger");
const { createMigrationRuntime } = require("./migrationRuntime");

function safeHost(value) {
    const host = String(value || "");
    return /^\[?[A-Za-z0-9_.:-]+\]?$/.test(host) ? host : "[INVALID_DB_HOST]";
}

function safeDatabaseName(value) {
    const database = String(value || "");
    return /^[A-Za-z0-9_$-]+$/.test(database)
        ? database
        : "[INVALID_DATABASE_NAME]";
}

function safeNodeEnvironment(value) {
    return ["development", "test", "production"].includes(value)
        ? value
        : "unknown";
}

function createSafeDatabaseTarget(config, env = process.env) {
    return {
        nodeEnv: safeNodeEnvironment(env.NODE_ENV),
        host: safeHost(config?.host),
        port: Number.isInteger(config?.port) ? config.port : null,
        database: safeDatabaseName(config?.database)
    };
}

function resultLogMethod(report) {
    if (report.state === "ready") {
        return "info";
    }
    return report.state === "pending" ? "warn" : "error";
}

async function main(options = {}) {
    let runtime = options.runtime;
    let logger = options.logger || runtime?.logger || createStructuredLogger();
    let target;
    let report;
    let failure;

    try {
        const databaseConfig =
            options.databaseConfig || db.readDatabaseConfig(options.env || process.env);
        target = createSafeDatabaseTarget(databaseConfig, options.env || process.env);
        runtime = runtime || createMigrationRuntime({ logger });
        logger = options.logger || runtime.logger || logger;

        await runtime.verifyConnection();
        const doctor =
            options.doctor || createMigrationDoctor({ pool: runtime.pool });
        report = await doctor.diagnose();

        if (safeDatabaseName(report.database) !== target.database) {
            throw doctorError(
                "DATABASE_TARGET_MISMATCH",
                "Configured and selected database targets do not match."
            );
        }
    } catch (error) {
        failure = error;
    } finally {
        if (runtime) {
            try {
                await runtime.close();
            } catch (error) {
                failure = failure || error;
            }
        }
    }

    const setExitCode =
        options.setExitCode || ((exitCode) => (process.exitCode = exitCode));

    if (failure) {
        const exitCode = DOCTOR_EXIT_CODES.OPERATIONAL_FAILURE;
        logger.error("migration_doctor_result", {
            code: "MIGRATION_DOCTOR_FAILED",
            state: "failed",
            exitCode,
            target,
            error: failure
        });
        setExitCode(exitCode);
        return {
            code: "MIGRATION_DOCTOR_FAILED",
            state: "failed",
            exitCode,
            target
        };
    }

    const logMethod = resultLogMethod(report);
    logger[logMethod]("migration_doctor_result", {
        ...report,
        target: {
            ...target,
            selectedDatabase: safeDatabaseName(report.database)
        },
        database: undefined
    });
    setExitCode(report.exitCode);
    return report;
}

if (require.main === module) {
    main();
}

module.exports = {
    createSafeDatabaseTarget,
    main,
    resultLogMethod,
    safeDatabaseName,
    safeHost,
    safeNodeEnvironment
};
