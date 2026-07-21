// Versioned, authenticated FitTrack backup container format (".ftbackup").
//
// Binary layout:
//
//   offset  size    field
//   0       8       magic bytes, ASCII "FTBACKUP"
//   8       1       format version (uint8)
//   9       4       header length L, unsigned big-endian uint32
//   13      L       header: canonical UTF-8 JSON - this is the GCM
//                    Additional Authenticated Data (AAD)
//   13+L    ...      AES-256-GCM ciphertext of the gzip-compressed
//                    mysqldump stream
//   end-16  16      GCM authentication tag (final 16 bytes of the file)
//
// The header is never secret (no key, no password, no user/training data)
// but is authenticated: any bitflip in it invalidates the tag exactly like
// a bitflip in the ciphertext would. The ciphertext region has no explicit
// length field - it is simply "everything between the header and the final
// 16 tag bytes" - so the file's own size on disk is what delimits it; this
// keeps the format fully streamable while writing (no need to know the
// dump's total size up front).
const crypto = require("node:crypto");
const fsPromises = require("node:fs/promises");

const MAGIC = Buffer.from("FTBACKUP", "ascii");
const FORMAT_VERSION = 1;
const HEADER_LENGTH_FIELD_SIZE = 4;
const PREFIX_FIXED_SIZE = MAGIC.length + 1 + HEADER_LENGTH_FIELD_SIZE;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_BYTE_LENGTH = 32;
const ALGORITHM = "aes-256-gcm";
const COMPRESSION = "gzip";
const BACKUP_KIND = "fittrack.mysql.encrypted-backup";
const MAX_HEADER_BYTES = 64 * 1024;
const DATABASE_NAME_PATTERN = /^[A-Za-z0-9_$-]+$/;
const MIGRATION_ID_PATTERN = /^\d{3,}_[a-z0-9_]+$/;

function formatError(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, details);
    return error;
}

function assertKey(key) {
    if (!Buffer.isBuffer(key) || key.length !== KEY_BYTE_LENGTH) {
        throw formatError(
            "BACKUP_FORMAT_INVALID_KEY",
            `Backup encryption key must be a ${KEY_BYTE_LENGTH}-byte buffer.`
        );
    }
}

// Builds the header with a fixed, deterministic key order so the same
// logical header always serializes to the same bytes - useful for tests
// and for reasoning about the AAD, though decoding never re-derives these
// bytes; it always authenticates the exact bytes read from the file.
function buildHeader({
    createdAt,
    keyId,
    database,
    ivBase64,
    appliedMigrations
}) {
    if (!(createdAt instanceof Date) || Number.isNaN(createdAt.getTime())) {
        throw formatError("BACKUP_FORMAT_INVALID_HEADER", "createdAt must be a valid Date.");
    }
    if (!DATABASE_NAME_PATTERN.test(database || "")) {
        throw formatError("BACKUP_FORMAT_INVALID_HEADER", "database name is invalid.");
    }
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(keyId || "")) {
        throw formatError("BACKUP_FORMAT_INVALID_HEADER", "keyId is invalid.");
    }
    const migrations = Array.isArray(appliedMigrations) ? appliedMigrations : [];
    for (const id of migrations) {
        if (!MIGRATION_ID_PATTERN.test(id)) {
            throw formatError("BACKUP_FORMAT_INVALID_HEADER", "appliedMigrations entries are invalid.");
        }
    }
    return {
        formatVersion: FORMAT_VERSION,
        kind: BACKUP_KIND,
        createdAt: createdAt.toISOString(),
        algorithm: ALGORITHM,
        compression: COMPRESSION,
        ivBase64,
        keyId,
        database,
        schema: {
            appliedMigrations: migrations,
            migrationCount: migrations.length
        }
    };
}

function encodeHeader(header) {
    const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
    if (headerBytes.length > MAX_HEADER_BYTES) {
        throw formatError("BACKUP_FORMAT_INVALID_HEADER", "Header is unexpectedly large.");
    }
    const lengthField = Buffer.alloc(HEADER_LENGTH_FIELD_SIZE);
    lengthField.writeUInt32BE(headerBytes.length, 0);
    const prefix = Buffer.concat([MAGIC, Buffer.from([FORMAT_VERSION]), lengthField, headerBytes]);
    return { prefix, headerBytes };
}

function validateHeaderShape(header) {
    if (!header || typeof header !== "object" || Array.isArray(header)) {
        throw formatError("BACKUP_INTEGRITY_FAILED", "Backup header is invalid.");
    }
    if (header.formatVersion !== FORMAT_VERSION) {
        throw formatError(
            "BACKUP_UNSUPPORTED_VERSION",
            `Unsupported backup format version: ${header.formatVersion}.`
        );
    }
    if (header.kind !== BACKUP_KIND) {
        throw formatError("BACKUP_INTEGRITY_FAILED", "Backup header kind is unexpected.");
    }
    if (header.algorithm !== ALGORITHM) {
        throw formatError("BACKUP_INTEGRITY_FAILED", "Backup header algorithm is unsupported.");
    }
    if (header.compression !== COMPRESSION) {
        throw formatError("BACKUP_INTEGRITY_FAILED", "Backup header compression is unsupported.");
    }
    if (!DATABASE_NAME_PATTERN.test(header.database || "")) {
        throw formatError("BACKUP_INTEGRITY_FAILED", "Backup header database name is invalid.");
    }
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(header.keyId || "")) {
        throw formatError("BACKUP_INTEGRITY_FAILED", "Backup header keyId is invalid.");
    }
    let iv;
    try {
        iv = Buffer.from(header.ivBase64, "base64");
    } catch {
        iv = Buffer.alloc(0);
    }
    if (iv.length !== IV_LENGTH) {
        throw formatError("BACKUP_INTEGRITY_FAILED", "Backup header IV is invalid.");
    }
    if (typeof header.createdAt !== "string" || Number.isNaN(new Date(header.createdAt).getTime())) {
        throw formatError("BACKUP_INTEGRITY_FAILED", "Backup header createdAt is invalid.");
    }
    return iv;
}

// Reads and validates just enough of the file to reconstruct the layout
// (header bytes for AAD, IV, ciphertext byte range, trailing tag) without
// ever reading the ciphertext body itself into memory here.
async function readBackupFileLayout(filePath) {
    const stat = await fsPromises.stat(filePath);
    if (!stat.isFile() || stat.size < PREFIX_FIXED_SIZE + TAG_LENGTH) {
        throw formatError("BACKUP_INTEGRITY_FAILED", "Backup file is missing or too small.");
    }

    const handle = await fsPromises.open(filePath, "r");
    try {
        const fixedPrefix = Buffer.alloc(PREFIX_FIXED_SIZE);
        const { bytesRead: prefixBytesRead } = await handle.read(fixedPrefix, 0, PREFIX_FIXED_SIZE, 0);
        if (prefixBytesRead !== PREFIX_FIXED_SIZE) {
            throw formatError("BACKUP_INTEGRITY_FAILED", "Backup file prefix is truncated.");
        }
        if (!fixedPrefix.subarray(0, MAGIC.length).equals(MAGIC)) {
            throw formatError("BACKUP_INVALID_MAGIC", "Backup file magic bytes are invalid.");
        }
        const version = fixedPrefix.readUInt8(MAGIC.length);
        if (version !== FORMAT_VERSION) {
            throw formatError(
                "BACKUP_UNSUPPORTED_VERSION",
                `Unsupported backup format version: ${version}.`
            );
        }
        const headerLength = fixedPrefix.readUInt32BE(MAGIC.length + 1);
        if (
            headerLength === 0 ||
            headerLength > MAX_HEADER_BYTES ||
            PREFIX_FIXED_SIZE + headerLength + TAG_LENGTH > stat.size
        ) {
            throw formatError("BACKUP_INTEGRITY_FAILED", "Backup header length is invalid.");
        }

        const headerBytes = Buffer.alloc(headerLength);
        const { bytesRead: headerBytesRead } = await handle.read(
            headerBytes,
            0,
            headerLength,
            PREFIX_FIXED_SIZE
        );
        if (headerBytesRead !== headerLength) {
            throw formatError("BACKUP_INTEGRITY_FAILED", "Backup header is truncated.");
        }

        let header;
        try {
            header = JSON.parse(headerBytes.toString("utf8"));
        } catch {
            throw formatError("BACKUP_INTEGRITY_FAILED", "Backup header JSON is invalid.");
        }
        const iv = validateHeaderShape(header);

        const ciphertextStart = PREFIX_FIXED_SIZE + headerLength;
        const ciphertextEnd = stat.size - TAG_LENGTH;
        if (ciphertextEnd < ciphertextStart) {
            throw formatError("BACKUP_INTEGRITY_FAILED", "Backup ciphertext region is invalid.");
        }

        const tag = Buffer.alloc(TAG_LENGTH);
        const { bytesRead: tagBytesRead } = await handle.read(tag, 0, TAG_LENGTH, ciphertextEnd);
        if (tagBytesRead !== TAG_LENGTH) {
            throw formatError("BACKUP_INTEGRITY_FAILED", "Backup authentication tag is truncated.");
        }

        return {
            header,
            headerBytes,
            iv,
            tag,
            ciphertextStart,
            ciphertextEnd,
            fileSize: stat.size
        };
    } finally {
        await handle.close();
    }
}

function createEncryptor({ key, iv, aad }) {
    assertKey(key);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(aad);
    return cipher;
}

function createDecryptor({ key, iv, aad, tag }) {
    assertKey(key);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return decipher;
}

module.exports = {
    ALGORITHM,
    BACKUP_KIND,
    COMPRESSION,
    FORMAT_VERSION,
    IV_LENGTH,
    KEY_BYTE_LENGTH,
    MAGIC,
    MAX_HEADER_BYTES,
    PREFIX_FIXED_SIZE,
    TAG_LENGTH,
    buildHeader,
    createDecryptor,
    createEncryptor,
    encodeHeader,
    formatError,
    readBackupFileLayout,
    validateHeaderShape
};
