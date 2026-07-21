// Streaming read/write glue for the FitTrack encrypted backup container
// (encryptedBackupFormat.js). Deliberately avoids ever mixing manual
// `.pipe()` calls with `stream.pipeline()` on the same stream - each
// operation below is a single, straightforward `pipeline(...)` call, which
// is easier to reason about and to get right than a hand-rolled tee.
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const { pipeline } = require("node:stream/promises");
const zlib = require("node:zlib");

const {
    TAG_LENGTH,
    createDecryptor,
    createEncryptor,
    encodeHeader,
    formatError,
    readBackupFileLayout
} = require("./encryptedBackupFormat");

// Writes magic+version+header, then the gzip-compressed, AES-256-GCM
// encrypted plaintext from `sourceStream`, then finally the GCM
// authentication tag - onto `destinationPath`. The tag is only known once
// the whole plaintext has passed through the cipher, so it is appended in
// a second, tiny positioned write after the main stream has fully closed;
// nothing is renamed to its final name here - the caller decides when
// (and whether) to promote the `.partial` file, per the atomic-write
// contract described in encryptedBackupCreate.js.
async function writeEncryptedBackup({ destinationPath, header, key, iv, sourceStream }) {
    const { prefix, headerBytes } = encodeHeader(header);
    const cipher = createEncryptor({ key, iv, aad: headerBytes });
    const output = fs.createWriteStream(destinationPath, { flags: "wx", mode: 0o600 });

    await new Promise((resolve, reject) => {
        // The stream's own "error" event (e.g. EEXIST if destinationPath
        // already exists, since "wx" is exclusive-create) fires
        // independently of the write() callback and, left unhandled, would
        // surface as an uncaught exception instead of rejecting this
        // promise.
        output.once("error", reject);
        output.write(prefix, (error) => (error ? reject(error) : resolve()));
    });
    await pipeline(sourceStream, zlib.createGzip(), cipher, output);
    const tag = cipher.getAuthTag();
    if (tag.length !== TAG_LENGTH) {
        throw new Error("Unexpected GCM authentication tag length.");
    }

    const stat = await fsPromises.stat(destinationPath);
    const handle = await fsPromises.open(destinationPath, "r+");
    try {
        await handle.write(tag, 0, tag.length, stat.size);
        await handle.sync();
    } finally {
        await handle.close();
    }

    return {
        bytes: stat.size + tag.length,
        headerBytes
    };
}

// Fully authenticates, decrypts and decompresses the backup at `filePath`,
// streaming the resulting plaintext SQL into `sink` (a Writable). Never
// writes plaintext to disk itself - it is the caller's responsibility to
// choose a `sink` that is either a discard/hashing sink (verify) or a
// child process's stdin (restore), never a filesystem write stream.
// Authentication failure (wrong key, tampered header/ciphertext/tag,
// truncated file) rejects the returned promise; per Node's GCM streaming
// semantics that rejection can only be observed once the entire ciphertext
// has been processed, which is exactly why restore always runs this once,
// discarding output, before ever running it again against the real target.
async function readAndProcessEncryptedBackup({ filePath, key, sink, expectedKeyId }) {
    const layout = await readBackupFileLayout(filePath);
    if (expectedKeyId && layout.header.keyId !== expectedKeyId) {
        throw formatError(
            "BACKUP_KEY_ID_MISMATCH",
            "The configured key ID does not match the key ID recorded in the backup header."
        );
    }
    const decipher = createDecryptor({
        key,
        iv: layout.iv,
        aad: layout.headerBytes,
        tag: layout.tag
    });
    const cipherStream = fs.createReadStream(filePath, {
        start: layout.ciphertextStart,
        end: layout.ciphertextEnd - 1
    });
    await pipeline(cipherStream, decipher, zlib.createGunzip(), sink);
    return { header: layout.header };
}

module.exports = {
    readAndProcessEncryptedBackup,
    writeEncryptedBackup
};
