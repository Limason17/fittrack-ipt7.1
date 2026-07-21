// Static-analysis proof, complementing the dynamic filesystem-watching test
// in encryptedBackupRestoreDrill.test.js: scans the actual encrypted backup
// production source files for patterns that would indicate a plaintext
// temp file or a shell-based escape hatch, rather than only inferring
// "streaming was used" from a failed SQL import.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SOURCE_FILES = [
    "encryptedBackupCreate.js",
    "encryptedBackupVerify.js",
    "encryptedBackupRestore.js",
    "encryptedBackupDrill.js",
    "encryptedBackupStream.js",
    "encryptedBackupFormat.js",
    "databaseTools.js"
].map((name) => path.join(__dirname, "..", "..", "scripts", name));

function readSource(filePath) {
    return fs.readFileSync(filePath, "utf8");
}

test("none of the encrypted backup scripts ever call mkdtemp (no plaintext temp directory is ever created)", () => {
    for (const filePath of SOURCE_FILES) {
        const source = readSource(filePath);
        assert.doesNotMatch(
            source,
            /mkdtemp/,
            `${path.basename(filePath)} must never create a temp directory via mkdtemp`
        );
    }
});

test("none of the encrypted backup scripts spawn a shell (shell:true) or use shell redirection", () => {
    for (const filePath of SOURCE_FILES) {
        const source = readSource(filePath);
        assert.doesNotMatch(
            source,
            /shell\s*:\s*true/,
            `${path.basename(filePath)} must never spawn its child process through a shell`
        );
        // A literal `>` used as a shell redirection operator inside a
        // spawned command string would be a red flag; this file only ever
        // builds argv arrays, so this checks for the suspicious pattern of
        // a quoted string containing a redirection operator.
        assert.doesNotMatch(
            source,
            /["'`][^"'`]*>\s*["'`]?\s*\$\{?\w*[Ff]ile/,
            `${path.basename(filePath)} must never build a shell redirection into a file`
        );
    }
});

test("createWriteStream/writeFile in the create/stream modules is only ever used for the encrypted .partial/.ftbackup artifact, never a .sql/.dump name", () => {
    const relevant = ["encryptedBackupCreate.js", "encryptedBackupStream.js"];
    for (const name of relevant) {
        const filePath = path.join(__dirname, "..", "..", "scripts", name);
        const source = readSource(filePath);
        const writeCalls = source.match(/createWriteStream\([^)]*\)/g) || [];
        assert.ok(writeCalls.length > 0, `expected at least one createWriteStream call in ${name}`);
        for (const call of writeCalls) {
            assert.doesNotMatch(call, /\.sql|\.dump/i, `unexpected plaintext-looking write target in ${name}: ${call}`);
        }
        // No plain fs.writeFile/fsPromises.writeFile of dump-shaped content -
        // the only permitted "whole buffer" write in this module family is
        // the small, already-encrypted GCM tag appended via a positioned
        // filehandle.write, never a bulk writeFile of SQL content.
        assert.doesNotMatch(
            source,
            /writeFile\([^)]*(sql|dump|plaintext)/i,
            `unexpected plaintext-shaped writeFile call in ${name}`
        );
    }
});

test("the mysqldump/mysql invocations only ever pipe through gzip and AES-256-GCM, never write an intermediate file", () => {
    const source = readSource(path.join(__dirname, "..", "..", "scripts", "encryptedBackupCreate.js"));
    // The only file this module opens for writing is the .partial path
    // itself; there must be exactly one createWriteStream call, feeding
    // directly from runDockerDatabaseTool's outputTransforms (gzip, cipher).
    const writeStreamCalls = (source.match(/createWriteStream/g) || []).length;
    assert.equal(writeStreamCalls, 1, "expected exactly one createWriteStream call (the .partial artifact itself)");
    assert.match(source, /outputTransforms:\s*\[gzip,\s*cipher\]/);
});
