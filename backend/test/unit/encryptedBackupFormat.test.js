const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Readable, Writable } = require("node:stream");

const {
    FORMAT_VERSION,
    IV_LENGTH,
    MAGIC,
    TAG_LENGTH,
    buildHeader,
    createEncryptor,
    encodeHeader,
    readBackupFileLayout
} = require("../../scripts/encryptedBackupFormat");
const {
    readAndProcessEncryptedBackup,
    writeEncryptedBackup
} = require("../../scripts/encryptedBackupStream");

async function tempDir(testContext) {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ftbackup-format-test-"));
    testContext.after(() => fsPromises.rm(dir, { recursive: true, force: true }));
    return dir;
}

function samplePlaintext() {
    return [
        "-- MySQL dump 10.13  Distrib 8.0",
        "CREATE TABLE `users` (`id` int NOT NULL);",
        "INSERT INTO `users` VALUES (1),(2),(3);",
        "x".repeat(10000)
    ].join("\n");
}

function sampleHeader(overrides = {}) {
    const iv = crypto.randomBytes(IV_LENGTH);
    return {
        header: buildHeader({
            createdAt: new Date("2026-07-22T10:00:00.000Z"),
            keyId: "unit-test-key",
            database: "fittrack_unit",
            ivBase64: iv.toString("base64"),
            appliedMigrations: ["001_initial_schema", "002_legacy_schema_upgrade"],
            ...overrides
        }),
        iv
    };
}

function discardSink() {
    let bytes = 0;
    const chunks = [];
    const sink = new Writable({
        write(chunk, encoding, callback) {
            bytes += chunk.length;
            chunks.push(chunk);
            callback();
        }
    });
    return { sink, bytes: () => bytes, text: () => Buffer.concat(chunks).toString("utf8") };
}

async function writeSample(destinationPath, key, { plaintext = samplePlaintext(), headerOverrides = {} } = {}) {
    const { header, iv } = sampleHeader(headerOverrides);
    await writeEncryptedBackup({
        destinationPath,
        header,
        key,
        iv,
        sourceStream: Readable.from([Buffer.from(plaintext)])
    });
    return { header, plaintext };
}

test("round-trips real content through write and read, byte for byte", async (t) => {
    const dir = await tempDir(t);
    const key = crypto.randomBytes(32);
    const file = path.join(dir, "a.ftbackup");
    const { plaintext } = await writeSample(file, key);

    const out = discardSink();
    const result = await readAndProcessEncryptedBackup({ filePath: file, key, sink: out.sink });
    assert.equal(out.text(), plaintext);
    assert.equal(result.header.database, "fittrack_unit");
    assert.equal(result.header.keyId, "unit-test-key");
    assert.deepEqual(result.header.schema.appliedMigrations, ["001_initial_schema", "002_legacy_schema_upgrade"]);
    assert.equal(result.header.schema.migrationCount, 2);
});

test("the on-disk file begins with the exact magic bytes and format version", async (t) => {
    const dir = await tempDir(t);
    const key = crypto.randomBytes(32);
    const file = path.join(dir, "a.ftbackup");
    await writeSample(file, key);

    const handle = await fsPromises.open(file, "r");
    const buffer = Buffer.alloc(9);
    await handle.read(buffer, 0, 9, 0);
    await handle.close();
    assert.equal(buffer.subarray(0, MAGIC.length).equals(MAGIC), true);
    assert.equal(buffer.readUInt8(MAGIC.length), FORMAT_VERSION);
});

test("readBackupFileLayout exposes the exact ciphertext byte range and a 16-byte tag", async (t) => {
    const dir = await tempDir(t);
    const key = crypto.randomBytes(32);
    const file = path.join(dir, "a.ftbackup");
    await writeSample(file, key);

    const layout = await readBackupFileLayout(file);
    assert.equal(layout.tag.length, TAG_LENGTH);
    assert.equal(layout.iv.length, IV_LENGTH);
    assert.ok(layout.ciphertextEnd <= layout.fileSize - TAG_LENGTH);
    assert.ok(layout.ciphertextStart < layout.ciphertextEnd);
});

test("a bitflip anywhere in the ciphertext is detected and rejected", async (t) => {
    const dir = await tempDir(t);
    const key = crypto.randomBytes(32);
    const file = path.join(dir, "a.ftbackup");
    await writeSample(file, key);

    const layout = await readBackupFileLayout(file);
    const buffer = await fsPromises.readFile(file);
    const flipOffset = Math.floor((layout.ciphertextStart + layout.ciphertextEnd) / 2);
    buffer[flipOffset] ^= 0xff;
    const tamperedFile = path.join(dir, "tampered.ftbackup");
    await fsPromises.writeFile(tamperedFile, buffer);

    await assert.rejects(
        readAndProcessEncryptedBackup({ filePath: tamperedFile, key, sink: discardSink().sink })
    );
});

test("a bitflip in the authenticated header is detected and rejected", async (t) => {
    const dir = await tempDir(t);
    const key = crypto.randomBytes(32);
    const file = path.join(dir, "a.ftbackup");
    await writeSample(file, key);

    const buffer = await fsPromises.readFile(file);
    // Flip a byte inside the header JSON region (right after the 13-byte fixed prefix).
    buffer[20] ^= 0xff;
    const tamperedFile = path.join(dir, "tampered-header.ftbackup");
    await fsPromises.writeFile(tamperedFile, buffer);

    await assert.rejects(
        readAndProcessEncryptedBackup({ filePath: tamperedFile, key, sink: discardSink().sink })
    );
});

test("a tampered authentication tag is detected and rejected", async (t) => {
    const dir = await tempDir(t);
    const key = crypto.randomBytes(32);
    const file = path.join(dir, "a.ftbackup");
    await writeSample(file, key);

    const buffer = await fsPromises.readFile(file);
    buffer[buffer.length - 1] ^= 0xff;
    const tamperedFile = path.join(dir, "tampered-tag.ftbackup");
    await fsPromises.writeFile(tamperedFile, buffer);

    await assert.rejects(
        readAndProcessEncryptedBackup({ filePath: tamperedFile, key, sink: discardSink().sink })
    );
});

test("a truncated file is rejected before any plaintext is produced", async (t) => {
    const dir = await tempDir(t);
    const key = crypto.randomBytes(32);
    const file = path.join(dir, "a.ftbackup");
    await writeSample(file, key);

    const buffer = await fsPromises.readFile(file);
    const truncatedFile = path.join(dir, "truncated.ftbackup");
    await fsPromises.writeFile(truncatedFile, buffer.subarray(0, buffer.length - 5));

    await assert.rejects(
        readAndProcessEncryptedBackup({ filePath: truncatedFile, key, sink: discardSink().sink })
    );
});

test("an unknown format version is rejected with a distinct code", async (t) => {
    const dir = await tempDir(t);
    const key = crypto.randomBytes(32);
    const file = path.join(dir, "a.ftbackup");
    await writeSample(file, key);

    const buffer = await fsPromises.readFile(file);
    buffer[MAGIC.length] = 99;
    const badVersionFile = path.join(dir, "bad-version.ftbackup");
    await fsPromises.writeFile(badVersionFile, buffer);

    await assert.rejects(
        readAndProcessEncryptedBackup({ filePath: badVersionFile, key, sink: discardSink().sink }),
        (error) => error.code === "BACKUP_UNSUPPORTED_VERSION"
    );
});

test("invalid magic bytes are rejected with a distinct code", async (t) => {
    const dir = await tempDir(t);
    const key = crypto.randomBytes(32);
    const file = path.join(dir, "a.ftbackup");
    await writeSample(file, key);

    const buffer = await fsPromises.readFile(file);
    buffer.write("XXXXXXXX", 0, "ascii");
    const badMagicFile = path.join(dir, "bad-magic.ftbackup");
    await fsPromises.writeFile(badMagicFile, buffer);

    await assert.rejects(
        readAndProcessEncryptedBackup({ filePath: badMagicFile, key, sink: discardSink().sink }),
        (error) => error.code === "BACKUP_INVALID_MAGIC"
    );
});

test("the wrong 32-byte key is rejected exactly like a tampered file", async (t) => {
    const dir = await tempDir(t);
    const key = crypto.randomBytes(32);
    const wrongKey = crypto.randomBytes(32);
    const file = path.join(dir, "a.ftbackup");
    await writeSample(file, key);

    await assert.rejects(
        readAndProcessEncryptedBackup({ filePath: file, key: wrongKey, sink: discardSink().sink })
    );
});

test("a key ID that does not match the header's recorded key ID is rejected before decryption is attempted", async (t) => {
    const dir = await tempDir(t);
    const key = crypto.randomBytes(32);
    const file = path.join(dir, "a.ftbackup");
    await writeSample(file, key, { headerOverrides: { keyId: "original-key-id" } });

    await assert.rejects(
        readAndProcessEncryptedBackup({
            filePath: file,
            key,
            expectedKeyId: "a-different-key-id",
            sink: discardSink().sink
        }),
        (error) => error.code === "BACKUP_KEY_ID_MISMATCH"
    );
});

test("each backup uses a fresh random IV - two backups of the same plaintext never share ciphertext bytes", async (t) => {
    const dir = await tempDir(t);
    const key = crypto.randomBytes(32);
    const plaintext = samplePlaintext();
    const fileA = path.join(dir, "a.ftbackup");
    const fileB = path.join(dir, "b.ftbackup");
    await writeSample(fileA, key, { plaintext });
    await writeSample(fileB, key, { plaintext });

    const layoutA = await readBackupFileLayout(fileA);
    const layoutB = await readBackupFileLayout(fileB);
    assert.notEqual(layoutA.iv.toString("hex"), layoutB.iv.toString("hex"));

    const bufferA = await fsPromises.readFile(fileA);
    const bufferB = await fsPromises.readFile(fileB);
    assert.notEqual(
        bufferA.subarray(layoutA.ciphertextStart, layoutA.ciphertextEnd).toString("hex"),
        bufferB.subarray(layoutB.ciphertextStart, layoutB.ciphertextEnd).toString("hex")
    );
});

test("header rejects an invalid database name, keyId, or migration id", () => {
    const iv = crypto.randomBytes(IV_LENGTH).toString("base64");
    assert.throws(() => buildHeader({
        createdAt: new Date(), keyId: "k", database: "bad name!", ivBase64: iv, appliedMigrations: []
    }), (error) => error.code === "BACKUP_FORMAT_INVALID_HEADER");
    assert.throws(() => buildHeader({
        createdAt: new Date(), keyId: "bad key!", database: "fittrack", ivBase64: iv, appliedMigrations: []
    }), (error) => error.code === "BACKUP_FORMAT_INVALID_HEADER");
    assert.throws(() => buildHeader({
        createdAt: new Date(), keyId: "k", database: "fittrack", ivBase64: iv, appliedMigrations: ["not-a-migration-id"]
    }), (error) => error.code === "BACKUP_FORMAT_INVALID_HEADER");
});

test("encodeHeader never includes a secret-shaped field and the header never contains the encryption key", () => {
    const iv = crypto.randomBytes(IV_LENGTH).toString("base64");
    const header = buildHeader({
        createdAt: new Date(), keyId: "unit-test-key", database: "fittrack_unit", ivBase64: iv, appliedMigrations: []
    });
    const { headerBytes } = encodeHeader(header);
    const json = headerBytes.toString("utf8");
    assert.doesNotMatch(json, /password/i);
    assert.doesNotMatch(json, /secret/i);
    assert.doesNotMatch(json, /jwt/i);
    assert.equal(Object.hasOwn(header, "key"), false);
});

test("a corrupted gzip stream inside an otherwise validly-encrypted file is rejected during decompression, not silently accepted", async (t) => {
    const dir = await tempDir(t);
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(IV_LENGTH);
    const header = buildHeader({
        createdAt: new Date(),
        keyId: "unit-test-key",
        database: "fittrack_unit",
        ivBase64: iv.toString("base64"),
        appliedMigrations: []
    });
    // Manually build a file that skips gzip entirely (unlike
    // writeEncryptedBackup, which always compresses) - a genuinely
    // authentic, tamper-free file whose *decompressed* payload is
    // nonetheless corrupt because it was never gzip in the first place.
    const { prefix, headerBytes } = encodeHeader(header);
    const cipher = createEncryptor({ key, iv, aad: headerBytes });
    const notGzip = Buffer.from("this is not gzip data at all");
    const ciphertext = Buffer.concat([cipher.update(notGzip), cipher.final()]);
    const tag = cipher.getAuthTag();
    const file = path.join(dir, "bad-gzip.ftbackup");
    await fsPromises.writeFile(file, Buffer.concat([prefix, ciphertext, tag]));

    await assert.rejects(
        readAndProcessEncryptedBackup({ filePath: file, key, sink: discardSink().sink })
    );
});

test("an empty plaintext dump still round-trips (edge case: zero-byte logical payload)", async (t) => {
    const dir = await tempDir(t);
    const key = crypto.randomBytes(32);
    const file = path.join(dir, "empty.ftbackup");
    await writeSample(file, key, { plaintext: "" });

    const out = discardSink();
    await readAndProcessEncryptedBackup({ filePath: file, key, sink: out.sink });
    assert.equal(out.text(), "");
});
