const db = require("./config/db");
const { createMigrationRunner } = require("./migrations/runner");
const { createApp } = require("./startup/app");
const { bootstrap } = require("./startup/bootstrap");
const { createStructuredLogger } = require("./startup/logger");
const { createReadinessProbe } = require("./startup/readiness");

function readPort(value = process.env.PORT) {
    if (value === undefined || value === null || value === "") {
        return 3001;
    }

    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        const error = new Error("PORT must be an integer between 1 and 65535.");
        error.code = "INVALID_PORT";
        throw error;
    }
    return port;
}

function listen(app, port) {
    return new Promise((resolve, reject) => {
        const server = app.listen(port);
        server.once("listening", () => resolve(server));
        server.once("error", reject);
    });
}

function closeServer(server) {
    return new Promise((resolve, reject) => {
        server.close((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}

function createRuntime({ pool = db, logger = createStructuredLogger() } = {}) {
    const migrationRunner = createMigrationRunner({ pool, logger });
    const database = {
        verifyConnection: () => db.verifyConnection(pool),
        close: () => db.closePool(pool)
    };
    const readiness = createReadinessProbe({
        ping: database.verifyConnection,
        migrationStatus: () => migrationRunner.status({ ensureLedger: false })
    });

    return {
        database,
        logger,
        migrationRunner,
        readiness
    };
}

function installShutdownHandlers({ server, database, readiness, logger }) {
    let shuttingDown = false;

    async function shutdown(signal) {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;
        readiness.markShuttingDown();
        logger.info("shutdown_started", { signal });

        try {
            await closeServer(server);
            await database.close();
            logger.info("shutdown_completed", { signal });
        } catch (error) {
            logger.error("shutdown_failed", { signal, error });
            process.exitCode = 1;
        }
    }

    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.once("SIGINT", () => shutdown("SIGINT"));

    return shutdown;
}

async function main(options = {}) {
    const runtime = options.runtime || createRuntime(options);
    const port = options.port || readPort();
    const result = await bootstrap({
        ...runtime,
        port,
        createApplication:
            options.createApplication ||
            (({ readiness, logger }) => createApp({ readiness, logger })),
        listen: options.listen || listen
    });

    installShutdownHandlers({
        server: result.server,
        database: runtime.database,
        readiness: runtime.readiness,
        logger: runtime.logger
    });

    return result;
}

if (require.main === module) {
    main().catch((error) => {
        const logger = createStructuredLogger();
        logger.error("process_start_failed", { error });
        process.exitCode = 1;
    });
}

module.exports = {
    bootstrap,
    closeServer,
    createApp,
    createRuntime,
    installShutdownHandlers,
    listen,
    main,
    readPort
};
