const { createStructuredLogger } = require("../startup/logger");
const { backupCliExitCode } = require("./backupExitCodes");
const { planRemoteRetention } = require("./backupRemoteRetention");

async function main() {
    const report = await planRemoteRetention();
    createStructuredLogger().info("remote_backup_retention_planned", {
        bucket: report.bucket,
        prefix: report.prefix,
        keepCount: report.keep.length,
        removeCount: report.remove.length
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
}

if (require.main === module) {
    main().catch((error) => {
        createStructuredLogger().error("remote_backup_retention_plan_failed", { error });
        process.exitCode = backupCliExitCode(error);
    });
}

module.exports = { main };
