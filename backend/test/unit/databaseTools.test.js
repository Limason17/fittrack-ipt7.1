const assert = require("node:assert/strict");
const test = require("node:test");

const {
    buildDockerExecArgs,
    createBackupFilename,
    looksLikeLogicalBackup
} = require("../../scripts/databaseTools");

test("docker database tools pass MYSQL_PWD by environment name, never by argument value", () => {
    const args = buildDockerExecArgs({
        container: "fittrack_mysql",
        executable: "mysqldump",
        toolArgs: ["--user=root", "fittrack"]
    });

    assert.deepEqual(args, [
        "exec",
        "--env",
        "MYSQL_PWD",
        "fittrack_mysql",
        "mysqldump",
        "--user=root",
        "fittrack"
    ]);
    assert.equal(JSON.stringify(args).includes("example-password"), false);
});

test("restore tool arguments opt in to stdin without weakening environment handling", () => {
    const args = buildDockerExecArgs({
        container: "fittrack_mysql",
        executable: "mysql",
        interactive: true,
        toolArgs: ["--user=root", "fittrack_restore_stage0b"]
    });

    assert.equal(args[1], "--interactive");
    assert.deepEqual(args.slice(2, 4), ["--env", "MYSQL_PWD"]);
});

test("backup filenames are timestamped, portable, and database-scoped", () => {
    assert.equal(
        createBackupFilename("fittrack", new Date("2026-07-18T12:34:56.789Z")),
        "fittrack-20260718T123456Z.sql"
    );
});

test("logical backup verification requires both a dump header and table DDL", () => {
    assert.equal(
        looksLikeLogicalBackup("-- MySQL dump 10.13\nCREATE TABLE `users` (`id` int);"),
        true
    );
    assert.equal(looksLikeLogicalBackup("-- MySQL dump 10.13\n-- no schema"), false);
    assert.equal(looksLikeLogicalBackup("CREATE TABLE `users` (`id` int);"), false);
});
