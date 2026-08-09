const crypto = require("node:crypto");

// Section 21.2: schemaVersion 1 is the only version this phase writes or
// accepts. 'reconciliation_reapplied' is written by the Doctor itself when
// a restore-reconciliation re-applies a deletion (Section 21.4) - never by
// the deletion transaction, which always writes 'deleted'.
const SCHEMA_VERSION = 1;
const LIFECYCLE_ACTIONS = Object.freeze(["deleted", "reconciliation_reapplied"]);
const HMAC_ALGORITHM = "HMAC-SHA256";
const RECEIPT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function receiptFormatError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

// Generic, recursive, key-sorted stringify - no reusable canonical-JSON
// helper exists elsewhere in the codebase (encryptedBackupFormat.js's own
// header canonicalization relies on a fixed object-literal key order
// instead, which is not reusable here). Sorting recursively rather than
// relying on construction order means the HMAC signature is stable even if
// a future field is added out of alphabetical order by mistake.
function stableStringify(value) {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(",")}]`;
    }
    const sortedKeys = Object.keys(value).sort();
    const entries = sortedKeys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(",")}}`;
}

function generateReceiptId(randomUUID = crypto.randomUUID) {
    const value = randomUUID().toLowerCase();
    if (!RECEIPT_ID_PATTERN.test(value)) {
        throw new TypeError("The receipt id generator must return a UUID v4.");
    }
    return value;
}

// The five content fields, and only these - Section 16's allowlist ("Receipt
// enthält nur allowlistete Felder"). accountRef is the internal users.id,
// never a public id or e-mail/username (Section 21.2's own reasoning: it is
// meaningless without direct database access, exactly like any other
// internal foreign-key reference in this schema).
function buildReceiptContent({ receiptId, accountRef, lifecycleAction, deletedAt }) {
    if (!RECEIPT_ID_PATTERN.test(String(receiptId || ""))) {
        throw receiptFormatError("DELETION_RECEIPT_INVALID_ID", "receiptId must be a UUID v4.");
    }
    if (!Number.isSafeInteger(accountRef) || accountRef <= 0) {
        throw receiptFormatError(
            "DELETION_RECEIPT_INVALID_ACCOUNT_REF",
            "accountRef must be a positive internal user id."
        );
    }
    if (!LIFECYCLE_ACTIONS.includes(lifecycleAction)) {
        throw receiptFormatError(
            "DELETION_RECEIPT_INVALID_LIFECYCLE_ACTION",
            `lifecycleAction must be one of: ${LIFECYCLE_ACTIONS.join(", ")}.`
        );
    }
    const deletedAtDate = deletedAt instanceof Date ? deletedAt : new Date(deletedAt);
    if (!Number.isFinite(deletedAtDate.getTime())) {
        throw receiptFormatError("DELETION_RECEIPT_INVALID_DELETED_AT", "deletedAt must be a valid date.");
    }

    return Object.freeze({
        schemaVersion: SCHEMA_VERSION,
        receiptId: receiptId.toLowerCase(),
        accountRef,
        lifecycleAction,
        deletedAt: deletedAtDate.toISOString()
    });
}

function signReceiptContent(content, key) {
    if (!Buffer.isBuffer(key)) {
        throw new TypeError("signReceiptContent requires a Buffer HMAC key.");
    }
    return crypto.createHmac("sha256", key).update(stableStringify(content), "utf8").digest("hex");
}

// Builds a complete, ready-to-publish receipt object (content + integrity
// block). Never writes to disk itself - see deletionReceiptStore.js for the
// atomic file-publication step, kept as a separate concern so the format
// module has no filesystem dependency and stays trivially unit-testable.
function buildReceipt({ receiptId, accountRef, lifecycleAction, deletedAt, key, keyId }) {
    if (typeof keyId !== "string" || !keyId) {
        throw new TypeError("buildReceipt requires a keyId.");
    }
    const content = buildReceiptContent({ receiptId, accountRef, lifecycleAction, deletedAt });
    const signature = signReceiptContent(content, key);
    return Object.freeze({
        ...content,
        integrity: Object.freeze({
            algorithm: HMAC_ALGORITHM,
            keyId,
            signature
        })
    });
}

// Fail-closed by construction: any shape problem, unknown schema version, or
// signature mismatch throws rather than returning a boolean - Section 21.5
// requires the caller to treat every failure mode identically (refuse to
// trust the receipt), so there is no partially-valid return value to
// mishandle.
function verifyReceipt(receipt, key) {
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
        throw receiptFormatError("DELETION_RECEIPT_MALFORMED", "Receipt is not a JSON object.");
    }
    if (receipt.schemaVersion !== SCHEMA_VERSION) {
        throw receiptFormatError(
            "DELETION_RECEIPT_UNKNOWN_SCHEMA_VERSION",
            `Receipt schemaVersion ${receipt.schemaVersion} is not supported (expected ${SCHEMA_VERSION}).`
        );
    }
    if (!receipt.integrity || receipt.integrity.algorithm !== HMAC_ALGORITHM) {
        throw receiptFormatError(
            "DELETION_RECEIPT_UNSUPPORTED_ALGORITHM",
            "Receipt integrity.algorithm must be HMAC-SHA256."
        );
    }
    if (typeof receipt.integrity.signature !== "string" || !/^[0-9a-f]{64}$/i.test(receipt.integrity.signature)) {
        throw receiptFormatError(
            "DELETION_RECEIPT_MALFORMED",
            "Receipt integrity.signature must be a 64-character hex HMAC-SHA256 digest."
        );
    }

    const content = buildReceiptContent({
        receiptId: receipt.receiptId,
        accountRef: receipt.accountRef,
        lifecycleAction: receipt.lifecycleAction,
        deletedAt: receipt.deletedAt
    });
    const expectedSignature = signReceiptContent(content, key);
    const expectedBuffer = Buffer.from(expectedSignature, "hex");
    const actualBuffer = Buffer.from(receipt.integrity.signature.toLowerCase(), "hex");
    if (
        expectedBuffer.length !== actualBuffer.length ||
        !crypto.timingSafeEqual(expectedBuffer, actualBuffer)
    ) {
        throw receiptFormatError(
            "DELETION_RECEIPT_INTEGRITY_INVALID",
            "Receipt HMAC signature does not match its content."
        );
    }

    return content;
}

module.exports = {
    HMAC_ALGORITHM,
    LIFECYCLE_ACTIONS,
    RECEIPT_ID_PATTERN,
    SCHEMA_VERSION,
    buildReceipt,
    buildReceiptContent,
    generateReceiptId,
    receiptFormatError,
    signReceiptContent,
    stableStringify,
    verifyReceipt
};
