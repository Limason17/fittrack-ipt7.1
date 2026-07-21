const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");

const db = require("../config/db");
const { createStructuredLogger } = require("../startup/logger");
const {
    assertExternalBackupDirectory,
    assertLegacyUnencryptedBackupAllowed,
    isLoopbackHost,
    safetyError
} = require("./databaseSafety");
const {
    createBackupFilename,
    runDockerDatabaseTool,
    verifyLogicalBackupFile
} = require("./databaseTools");

const REPOSITORY_ROOT = path.resolve(__dirname, "../..");

async function createBackup({ env = process.env, now = new Date() } = {}) {
    const config = db.readDatabaseConfig(env);
    // readDatabaseConfig() loads backend/.env as a side effect (via
    // config/db.js's loadBackendEnvironment), so NODE_ENV/ALLOW_LEGACY_*
    // are only guaranteed to reflect the real configuration once it has
    // run - this check must come after that, but still strictly before any
    // directory, file or Docker operation below.
    assertLegacyUnencryptedBackupAllowed(env);
    if (!isLoopbackHost(config.host)) {
        throw safetyError(
            "BACKUP_TARGET_FORBIDDEN",
            "The Docker backup command is restricted to a loopback database target."
        );
    }

    const requestedDirectory = assertExternalBackupDirectory(
        env.FITTRACK_BACKUP_DIR,
        REPOSITORY_ROOT
    );
    await fsPromises.mkdir(requestedDirectory, { recursive: true });
    const backupDirectory = await fsPromises.realpath(requestedDirectory);
    assertExternalBackupDirectory(backupDirectory, await fsPromises.realpath(REPOSITORY_ROOT));

    const filename = createBackupFilename(config.database, now);
    const finalPath = path.join(backupDirectory, filename);
    const partialPath = `${finalPath}.partial`;
    const output = fs.createWriteStream(partialPath, { flags: "wx", mode: 0o600 });

    try {
        await runDockerDatabaseTool({
            container: env.FITTRACK_DB_CONTAINER || "fittrack_mysql",
            executable: "mysqldump",
            password: config.password,
            toolArgs: [
                `--user=${config.user}`,
                "--single-transaction",
                "--quick",
                "--routines",
                "--triggers",
                "--events",
                "--hex-blob",
                "--set-gtid-purged=OFF",
                "--no-tablespaces",
                "--skip-lock-tables",
                "--default-character-set=utf8mb4",
                config.database
            ],
            output
        });

        const verification = await verifyLogicalBackupFile(partialPath);
        await fsPromises.rename(partialPath, finalPath);
        return {
            database: config.database,
            path: finalPath,
            createdAt: now.toISOString(),
            ...verification
        };
    } catch (error) {
        output.destroy();
        await fsPromises.rm(partialPath, { force: true });
        throw error;
    }
}

async function main() {
    const report = await createBackup();
    process.stdout.write(`${JSON.stringify(report)}\n`);
}

if (require.main === module) {
    main().catch((error) => {
        createStructuredLogger().error("database_backup_failed", { error });
        process.exitCode = 1;
    });
}

module.exports = {
    REPOSITORY_ROOT,
    createBackup,
    main
};
