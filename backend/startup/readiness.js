function migrationIssueReason(status) {
    if ((status?.dirty || []).length > 0) {
        return "migrations_dirty";
    }
    if ((status?.drift || []).length > 0) {
        return "migrations_drift";
    }
    if ((status?.unknown || []).length > 0) {
        return "migrations_unknown";
    }
    if ((status?.pending || []).length > 0) {
        return "migrations_pending";
    }
    return null;
}

// Stage 5C1: optional, defaults to a no-op that always reports ready - only
// callers that actually wire a deletionReceiptStatus function (server.js)
// gain this check, so existing tests/callers that construct a readiness
// probe without it are unaffected.
async function defaultDeletionReceiptStatus() {
    return { ready: true };
}

function createReadinessProbe({ ping, migrationStatus, deletionReceiptStatus = defaultDeletionReceiptStatus }) {
    if (typeof ping !== "function" || typeof migrationStatus !== "function") {
        throw new TypeError("Readiness probe requires ping and migrationStatus functions.");
    }
    if (typeof deletionReceiptStatus !== "function") {
        throw new TypeError("Readiness probe's deletionReceiptStatus must be a function.");
    }

    let lifecycle = "starting";

    return {
        markReady() {
            lifecycle = "ready";
        },
        markFailed() {
            lifecycle = "failed";
        },
        markShuttingDown() {
            lifecycle = "shutting_down";
        },
        state() {
            return lifecycle;
        },
        async check() {
            if (lifecycle !== "ready") {
                return {
                    ready: false,
                    reason: lifecycle
                };
            }

            try {
                await ping();
            } catch (error) {
                return {
                    ready: false,
                    reason: "database_unavailable"
                };
            }

            let status;
            try {
                status = await migrationStatus();
            } catch (error) {
                return {
                    ready: false,
                    reason: "migration_status_unavailable"
                };
            }

            const reason = migrationIssueReason(status);
            if (reason) {
                return { ready: false, reason };
            }

            // Section 18/21: fail-closed on a corrupted/unknown-version
            // receipt, an unresolved restore-reconciliation case, or unsafe
            // configuration - mirrors the migration-status check above,
            // added as an independent gate rather than folded into it so a
            // migration problem and a receipt problem are never reported
            // under the same ambiguous reason string.
            let deletionReceipts;
            try {
                deletionReceipts = await deletionReceiptStatus();
            } catch (error) {
                return { ready: false, reason: "deletion_receipt_status_unavailable" };
            }
            if (!deletionReceipts.ready) {
                return { ready: false, reason: deletionReceipts.reason || "deletion_receipts_not_ready" };
            }

            return { ready: true };
        }
    };
}

module.exports = {
    createReadinessProbe,
    migrationIssueReason
};
