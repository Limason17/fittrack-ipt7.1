const { readDeletionReceiptConfig } = require("../config/deletionReceiptConfig");
const { buildReceipt, generateReceiptId } = require("../security/deletionReceipts");
const { publishReceipt } = require("./deletionReceiptStore");
const { diagnoseDeletionReceipts } = require("./deletionReceiptDoctor");

function reconciliationError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

// Read-only: shows exactly what an apply run would do, without doing any
// of it - Section 19's "prüfen; Plan anzeigen" steps, sharing the same
// diagnosis the Doctor itself uses so a plan can never show something apply
// would not actually act on.
async function planReconciliation({ connection, readConfig = readDeletionReceiptConfig, env = process.env } = {}) {
    const diagnosis = await diagnoseDeletionReceipts({ connection, readConfig, env });
    return {
        state: diagnosis.state,
        toReapply: diagnosis.restoredActiveAccounts,
        toHealReceipt: diagnosis.missingReceipts,
        corruptedReceipts: diagnosis.corruptedReceipts,
        unknownReceipts: diagnosis.unknownReceipts
    };
}

// Section 19's destructive step, gated by three independent, explicit
// acknowledgements (mirrors databaseSafety.js's
// assertRestoreTargetAcknowledgement idiom: an ack must exactly equal
// "<verb>:<target>", never a bare boolean, so a copy-pasted "true" from an
// unrelated runbook can never accidentally authorize this against the
// wrong database or receipt directory):
//   1. FITTRACK_DELETION_RECONCILE_APPLY === "true"
//   2. FITTRACK_DELETION_RECONCILE_DATABASE_ACK === "reconcile:<current database name>"
//   3. FITTRACK_DELETION_RECONCILE_RECEIPT_DIR_ACK === the exact configured DELETION_RECEIPT_DIR
function assertReconciliationAuthorized({ env, databaseName, receiptDirectory }) {
    if (env.FITTRACK_DELETION_RECONCILE_APPLY !== "true") {
        throw reconciliationError(
            "DELETION_RECONCILE_NOT_AUTHORIZED",
            "FITTRACK_DELETION_RECONCILE_APPLY must be exactly \"true\" to reconcile any account."
        );
    }
    const expectedDatabaseAck = `reconcile:${databaseName}`;
    if (env.FITTRACK_DELETION_RECONCILE_DATABASE_ACK !== expectedDatabaseAck) {
        throw reconciliationError(
            "DELETION_RECONCILE_DATABASE_ACK_INVALID",
            `FITTRACK_DELETION_RECONCILE_DATABASE_ACK must exactly equal "${expectedDatabaseAck}".`
        );
    }
    if (env.FITTRACK_DELETION_RECONCILE_RECEIPT_DIR_ACK !== receiptDirectory) {
        throw reconciliationError(
            "DELETION_RECONCILE_RECEIPT_DIR_ACK_INVALID",
            "FITTRACK_DELETION_RECONCILE_RECEIPT_DIR_ACK must exactly equal the configured DELETION_RECEIPT_DIR."
        );
    }
}

// Re-applies an already-decided deletion for each restored-active account
// (idempotent: executeDeletionTransaction's own CAS-guarded UPDATE/DELETE
// makes a repeat application against an already-deleted row a safe no-op),
// and self-heals any deleted row missing its receipt entirely (Section
// 18.3's crash-window-A case - reconstructed purely from the row's own
// already-correct deleted_at, no deletion logic re-run). Every action taken
// is logged, without PII, per Section 19's "vollständigen Audit-/
// strukturierten Logeintrag ohne PII".
async function applyReconciliation({
    connection,
    deletionService,
    databaseName,
    readConfig = readDeletionReceiptConfig,
    generateReceiptId: generateReceiptIdFn = generateReceiptId,
    env = process.env,
    logger = console
}) {
    if (!connection || typeof connection.query !== "function") {
        throw new TypeError("applyReconciliation requires a database connection.");
    }
    if (!deletionService || typeof deletionService.executeDeletionTransaction !== "function") {
        throw new TypeError("applyReconciliation requires an account deletion service.");
    }
    if (typeof databaseName !== "string" || !databaseName) {
        throw new TypeError("applyReconciliation requires the current database name.");
    }

    const config = readConfig(env);
    if (!config.configured) {
        throw reconciliationError(
            "DELETION_RECEIPT_CONFIGURATION_UNSAFE",
            "Deletion receipts are not configured; reconciliation cannot proceed."
        );
    }
    assertReconciliationAuthorized({ env, databaseName, receiptDirectory: config.directory });

    const plan = await planReconciliation({ connection, readConfig, env });
    if (plan.corruptedReceipts.length > 0 || plan.unknownReceipts.length > 0) {
        throw reconciliationError(
            "DELETION_RECEIPT_CORRUPTED",
            "Corrupted or unknown-version receipts exist; resolve them manually before reconciling."
        );
    }

    const reapplied = [];
    for (const accountRef of plan.toReapply) {
        try {
            await deletionService.executeDeletionTransaction(accountRef, {
                requestId: "deletion-receipt-reconciliation",
                lifecycleAction: "reconciliation_reapplied"
            });
            reapplied.push({ accountRef, status: "reapplied" });
            logger.info?.("deletion_reconciliation_reapplied", { accountRef });
        } catch (error) {
            reapplied.push({ accountRef, status: "failed", code: error.code });
            logger.error?.("deletion_reconciliation_reapply_failed", { accountRef, code: error.code });
        }
    }

    const healedReceipts = [];
    for (const userId of plan.toHealReceipt) {
        const [rows] = await connection.query(
            "SELECT deleted_at FROM users WHERE id = ? AND lifecycle_status = 'deleted'",
            [userId]
        );
        if (rows.length === 0) {
            continue;
        }
        const receipt = buildReceipt({
            receiptId: generateReceiptIdFn(),
            accountRef: userId,
            lifecycleAction: "deleted",
            deletedAt: rows[0].deleted_at,
            key: config.key,
            keyId: config.keyId
        });
        await publishReceipt(config.directory, receipt);
        healedReceipts.push(userId);
        logger.info?.("deletion_receipt_self_healed", { accountRef: userId });
    }

    return { reapplied, healedReceipts };
}

module.exports = {
    applyReconciliation,
    assertReconciliationAuthorized,
    planReconciliation,
    reconciliationError
};
