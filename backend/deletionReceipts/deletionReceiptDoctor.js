const path = require("node:path");

const { readDeletionReceiptConfig } = require("../config/deletionReceiptConfig");
const { verifyReceipt } = require("../security/deletionReceipts");
const { listReceiptFiles, readReceiptFile } = require("./deletionReceiptStore");

const STATE = Object.freeze({
    READY: "ready",
    NOT_CONFIGURED: "not_configured",
    RECOVERY_REQUIRED: "recovery_required",
    CONFIGURATION_UNSAFE: "configuration_unsafe"
});

// A distinct, small exit-code family for this tool family (mirrors the
// Migration Doctor's own small dense scheme, DOCTOR_EXIT_CODES in
// migrations/doctor.js, but is not the same numbering - the two doctors are
// unrelated tools and a shared table would risk one's meaning drifting
// under the other's changes).
const EXIT_CODES = Object.freeze({
    READY: 0,
    CONFIGURATION_UNSAFE: 1,
    RECOVERY_REQUIRED: 3
});

function emptyReport(overrides) {
    return {
        receiptCount: 0,
        deletedAccountCount: 0,
        missingReceipts: [],
        restoredActiveAccounts: [],
        corruptedReceipts: [],
        unknownReceipts: [],
        configurationIssues: [],
        ...overrides
    };
}

// Read-only by construction: every DB access below is a plain SELECT, and
// every filesystem access is a plain read - Section 17's "Trenne klar:
// Prüfung; Diagnose; Reconciliation; Mutationsbefehl" - this function is
// only the first two. Reconciliation/mutation live in
// deletionReceiptReconciliation.js.
async function diagnoseDeletionReceipts({ connection, readConfig = readDeletionReceiptConfig, env = process.env } = {}) {
    if (!connection || typeof connection.query !== "function") {
        throw new TypeError("diagnoseDeletionReceipts requires a database connection.");
    }

    let config;
    try {
        config = readConfig(env);
    } catch (error) {
        return {
            state: STATE.CONFIGURATION_UNSAFE,
            code: "DELETION_RECEIPT_DOCTOR_CONFIGURATION_UNSAFE",
            exitCode: EXIT_CODES.CONFIGURATION_UNSAFE,
            ready: false,
            recoveryRequired: false,
            ...emptyReport({ configurationIssues: [error.message] })
        };
    }

    if (!config.configured) {
        const production = env.NODE_ENV === "production";
        return {
            state: production ? STATE.CONFIGURATION_UNSAFE : STATE.NOT_CONFIGURED,
            code: production
                ? "DELETION_RECEIPT_DOCTOR_CONFIGURATION_UNSAFE"
                : "DELETION_RECEIPT_DOCTOR_NOT_CONFIGURED",
            exitCode: production ? EXIT_CODES.CONFIGURATION_UNSAFE : EXIT_CODES.READY,
            ready: !production,
            recoveryRequired: false,
            ...emptyReport({
                configurationIssues: production
                    ? ["Deletion receipts are not configured in production."]
                    : []
            })
        };
    }

    const filePaths = await listReceiptFiles(config.directory);
    const corruptedReceipts = [];
    const unknownReceipts = [];
    const validReceiptsByAccountRef = new Map();

    for (const filePath of filePaths) {
        const basename = path.basename(filePath);
        let parsed;
        try {
            parsed = await readReceiptFile(filePath);
        } catch (error) {
            corruptedReceipts.push(basename);
            continue;
        }
        if (parsed && parsed.schemaVersion !== 1) {
            unknownReceipts.push(basename);
            continue;
        }
        try {
            const content = verifyReceipt(parsed, config.key);
            const existing = validReceiptsByAccountRef.get(content.accountRef);
            if (!existing || content.deletedAt > existing.deletedAt) {
                validReceiptsByAccountRef.set(content.accountRef, content);
            }
        } catch (error) {
            corruptedReceipts.push(basename);
        }
    }

    const restoredActiveAccounts = [];
    let deletedAccountCount = 0;
    for (const [accountRef] of validReceiptsByAccountRef) {
        const [rows] = await connection.query(
            "SELECT lifecycle_status FROM users WHERE id = ?",
            [accountRef]
        );
        if (rows.length === 0 || rows[0].lifecycle_status === "deleted") {
            // Either hard-deleted (row correctly absent) or anonymized
            // (row present, correctly terminal) - both are the consistent,
            // expected terminal state a valid receipt should describe.
            deletedAccountCount += 1;
        } else {
            // A restore brought back a pre-deletion snapshot (Section 21.4).
            restoredActiveAccounts.push(accountRef);
        }
    }

    // Self-healing case (Section 18.3, crash window A): a deleted row with
    // no receipt at all is not fail-closed on its own - the row is already
    // correctly anonymized/absent - but it is reported so an operator (or
    // the reconciliation apply command) can reconstruct the missing
    // receipt from the row's own deleted_at.
    const [deletedWithoutReceiptRows] = await connection.query(
        "SELECT id FROM users WHERE lifecycle_status = 'deleted'"
    );
    const missingReceipts = deletedWithoutReceiptRows
        .map((row) => row.id)
        .filter((id) => !validReceiptsByAccountRef.has(id));

    const recoveryRequired =
        restoredActiveAccounts.length > 0 || corruptedReceipts.length > 0 || unknownReceipts.length > 0;

    return {
        state: recoveryRequired ? STATE.RECOVERY_REQUIRED : STATE.READY,
        code: recoveryRequired ? "DELETION_RECEIPT_DOCTOR_RECOVERY_REQUIRED" : "DELETION_RECEIPT_DOCTOR_OK",
        exitCode: recoveryRequired ? EXIT_CODES.RECOVERY_REQUIRED : EXIT_CODES.READY,
        ready: !recoveryRequired,
        recoveryRequired,
        receiptCount: filePaths.length,
        deletedAccountCount,
        missingReceipts,
        restoredActiveAccounts,
        corruptedReceipts,
        unknownReceipts,
        configurationIssues: []
    };
}

module.exports = {
    EXIT_CODES,
    STATE,
    diagnoseDeletionReceipts
};
