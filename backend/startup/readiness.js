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

function createReadinessProbe({ ping, migrationStatus }) {
    if (typeof ping !== "function" || typeof migrationStatus !== "function") {
        throw new TypeError("Readiness probe requires ping and migrationStatus functions.");
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

            return { ready: true };
        }
    };
}

module.exports = {
    createReadinessProbe,
    migrationIssueReason
};
