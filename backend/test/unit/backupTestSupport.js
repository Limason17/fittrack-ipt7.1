const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
    createBackupManifest,
    writeJsonExclusive
} = require("../../scripts/databaseBackupPolicy");
const {
    compressLogicalBackupFile,
    createBackupFilename,
    verifyLogicalBackupFile
} = require("../../scripts/databaseTools");

const SERVER_UUID = "11111111-1111-1111-1111-111111111111";

function logicalDump(label = "fixture") {
    return [
        "-- MySQL dump 10.13  Distrib 8.0",
        `-- ${label}`,
        "CREATE TABLE `users` (`id` int NOT NULL);",
        "INSERT INTO `users` VALUES (1);",
        "-- filler ".repeat(40),
        ""
    ].join("\n");
}

async function createBackupWorkspace(testContext) {
    const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "fittrack-backup-test-"));
    const repositoryRoot = path.join(root, "repository");
    const backupDirectory = path.join(root, "backups");
    await Promise.all([
        fsPromises.mkdir(repositoryRoot),
        fsPromises.mkdir(backupDirectory)
    ]);
    testContext.after(() => fsPromises.rm(root, { recursive: true, force: true }));
    return { root, repositoryRoot, backupDirectory };
}

async function createBackupFixture({
    backupDirectory,
    database = "fittrack",
    createdAt,
    completedAt = createdAt,
    label
}) {
    const rawName = createBackupFilename(database, createdAt);
    const rawPath = path.join(backupDirectory, `${rawName}.fixture`);
    const artifactPath = path.join(backupDirectory, `${rawName}.gz`);
    const manifestPath = `${artifactPath}.manifest.json`;
    await fsPromises.writeFile(rawPath, logicalDump(label || rawName), { mode: 0o600 });
    const logicalVerification = await verifyLogicalBackupFile(rawPath);
    const artifactVerification = await compressLogicalBackupFile(rawPath, artifactPath);
    const manifest = createBackupManifest({
        database,
        serverUuid: SERVER_UUID,
        createdAt,
        completedAt,
        artifactName: path.basename(artifactPath),
        artifactVerification,
        logicalVerification
    });
    await writeJsonExclusive(manifestPath, manifest);
    await fsPromises.rm(rawPath);
    return { artifactPath, manifestPath, manifest };
}

function statusEnvironment(backupDirectory, database = "fittrack") {
    return {
        DB_NAME: database,
        FITTRACK_BACKUP_DIR: backupDirectory,
        FITTRACK_BACKUP_EXPECTED_DATABASE: database,
        FITTRACK_BACKUP_ACK: `backup:${database}`
    };
}

module.exports = {
    SERVER_UUID,
    createBackupFixture,
    createBackupWorkspace,
    logicalDump,
    statusEnvironment
};
