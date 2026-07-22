const { createStructuredLogger } = require("../startup/logger");
const { backupCliExitCode } = require("./backupExitCodes");
const { applyRemoteRetention } = require("./backupRemoteRetention");

async function main() {
    const report = await applyRemoteRetention();
    createStructuredLogger().info("remote_backup_retention_applied", {
        bucket: report.bucket,
        prefix: report.prefix,
        deletionType: report.deletionType,
        deletedCount: report.deletedCount
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
}

if (require.main === module) {
    main().catch((error) => {
        createStructuredLogger().error("remote_backup_retention_apply_failed", { error });
        process.exitCode = backupCliExitCode(error);
    });
}

module.exports = { main };
