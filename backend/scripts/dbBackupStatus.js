const path = require("node:path");

const {
    checkBackupStatus,
    safeBackupFailure
} = require("./databaseBackupPolicy");

const REPOSITORY_ROOT = path.resolve(__dirname, "../..");

async function backupStatus({
    env = process.env,
    now = new Date(),
    repositoryRoot = REPOSITORY_ROOT
} = {}) {
    return checkBackupStatus({ env, now, repositoryRoot });
}

async function main() {
    const report = await backupStatus();
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = report.exitCode;
    return report;
}

if (require.main === module) {
    main().catch((error) => {
        const report = safeBackupFailure(error, "database_backup_status");
        process.stderr.write(`${JSON.stringify(report)}\n`);
        process.exitCode = report.exitCode;
    });
}

module.exports = {
    REPOSITORY_ROOT,
    backupStatus,
    main
};
