// Shared download+verify core for Stage 2B2A's db:backup:remote:download
// and db:backup:remote:verify commands. The only difference between the two
// commands is whether the resulting local .ftbackup file is kept
// (download) or always removed again afterward (verify) - everything else,
// including the safety ordering, is identical and lives here exactly once.
//
// Ordering is deliberate and mirrors Stage 2B1's local restore contract:
// 1) stream to an exclusively-created `.partial` file while hashing every
//    byte, 2) compare that hash against the ciphertext-sha256 recorded in
//    the object's own metadata, 3) run the *same* full Stage 2B1 verify
//    (GCM authentication + key-id match) the local db:backup:verify command
//    uses, all before the file is ever renamed to its final, "trusted"
//    .ftbackup name. Nothing is decrypted, and no plaintext SQL is ever
//    produced, at any point in this file.
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");

const { readBackupCryptoConfig } = require("../config/backupCryptoConfig");
const { readBackupRemoteConfig } = require("../config/backupRemoteConfig");
const { assertExternalBackupDirectory } = require("./databaseSafety");
const { hashingDiscardSink } = require("./encryptedBackupVerify");
const { readAndProcessEncryptedBackup } = require("./encryptedBackupStream");
const { assertObjectKeyWithinPrefix } = require("./backupRemoteObjectKey");
const { createS3Client, downloadObjectToSink, headObject, remoteError } = require("./backupRemoteStorage");

const REPOSITORY_ROOT = path.resolve(__dirname, "../..");

async function fsyncFile(filePath) {
    const handle = await fsPromises.open(filePath, "r+");
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
}

async function fetchAndVerifyRemoteBackup({ env = process.env, key, destinationDirectory, keepFile }) {
    const remoteConfig = readBackupRemoteConfig(env);
    assertObjectKeyWithinPrefix(remoteConfig.prefix, key);

    const requestedDirectory = assertExternalBackupDirectory(destinationDirectory, REPOSITORY_ROOT);
    await fsPromises.mkdir(requestedDirectory, { recursive: true, mode: 0o700 });
    const targetDirectory = await fsPromises.realpath(requestedDirectory);
    assertExternalBackupDirectory(targetDirectory, await fsPromises.realpath(REPOSITORY_ROOT));

    const filename = path.basename(key);
    const finalPath = path.join(targetDirectory, filename);
    const partialPath = `${finalPath}.partial`;

    try {
        await fsPromises.access(finalPath);
        throw remoteError(
            "REMOTE_DOWNLOAD_TARGET_EXISTS",
            "A local file already exists at the download target; downloads never overwrite an existing file."
        );
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }

    const client = createS3Client(remoteConfig);
    const head = await headObject({ client, remoteConfig, key });
    const expectedSha256 = head.Metadata?.["ciphertext-sha256"];
    if (!/^[a-f0-9]{64}$/.test(expectedSha256 || "")) {
        throw remoteError(
            "REMOTE_METADATA_INCONSISTENT",
            "Remote object is missing a valid ciphertext-sha256 metadata value; refusing to download."
        );
    }

    const sink = fs.createWriteStream(partialPath, { flags: "wx", mode: 0o600 });
    try {
        const { bytes, sha256 } = await downloadObjectToSink({ client, remoteConfig, key, sink });
        if (head.ContentLength !== undefined && bytes !== head.ContentLength) {
            throw remoteError(
                "REMOTE_DOWNLOAD_INCOMPLETE",
                `Downloaded ${bytes} bytes but the remote object reports ${head.ContentLength} bytes.`
            );
        }
        if (sha256 !== expectedSha256) {
            throw remoteError(
                "REMOTE_CIPHERTEXT_HASH_MISMATCH",
                "Downloaded ciphertext SHA-256 does not match the remote object's own recorded metadata."
            );
        }
        await fsyncFile(partialPath);

        // Full Stage 2B1 verify against the *partial* path - authentication
        // must succeed before this file is ever treated as a trusted local
        // .ftbackup. This calls the same primitives db:backup:verify uses
        // (not that command's file-path wrapper, which insists on a
        // .ftbackup extension the still-".partial" file does not have yet).
        // Also enforces the local key-id, so a remote file encrypted under a
        // different key is rejected here, not silently accepted as a
        // same-named local artifact.
        const cryptoConfig = readBackupCryptoConfig(env);
        const { sink: discardSink, digest, byteCount } = hashingDiscardSink();
        const { header } = await readAndProcessEncryptedBackup({
            filePath: partialPath,
            key: cryptoConfig.key,
            expectedKeyId: cryptoConfig.keyId,
            sink: discardSink
        });

        await fsPromises.rename(partialPath, finalPath);

        if (!keepFile) {
            await fsPromises.rm(finalPath, { force: true });
        }

        return {
            result: "ok",
            bucket: remoteConfig.bucket,
            key,
            bytes,
            ciphertextSha256: sha256,
            formatVersion: header.formatVersion,
            keyId: header.keyId,
            createdAt: header.createdAt,
            logicalBytes: byteCount(),
            logicalSha256: digest(),
            localPath: keepFile ? finalPath : null
        };
    } catch (error) {
        await fsPromises.rm(partialPath, { force: true });
        await fsPromises.rm(finalPath, { force: true });
        throw error;
    }
}

module.exports = {
    REPOSITORY_ROOT,
    fetchAndVerifyRemoteBackup
};
