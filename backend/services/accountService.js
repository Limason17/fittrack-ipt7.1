const bcrypt = require("bcryptjs");
const {
    AppError,
    NotFoundError
} = require("../errors/AppError");
const {
    CurrentPasswordInvalidError,
    EmailAlreadyInUseError,
    EmailChangeRequestNotFoundError,
    EmailChangeTokenInvalidError,
    EmailUnchangedError,
    NewPasswordSameAsCurrentError,
    PasswordConfirmationMismatchError
} = require("../errors/AccountErrors");
const { createPublicId } = require("../domain/studioDomain");
const { createEmailChangeToken, hashEmailChangeToken } = require("../security/accountTokens");
const { createAccountEmailDelivery } = require("../delivery/accountEmailDelivery");

// Not env-configurable, matching studioService.js's own INVITATION_LIFETIME_MS
// (also a hardcoded module constant, not read from the environment).
const EMAIL_CHANGE_TOKEN_LIFETIME_MS = 60 * 60 * 1000;
const PASSWORD_HASH_COST = 10;

function promiseDatabase(database) {
    return typeof database.promise === "function" ? database.promise() : database;
}

function applicationError(status, code, message) {
    return new AppError({ status, code, message });
}

function emailChangeRequestStateError(status) {
    const states = {
        confirmed: [409, "EMAIL_CHANGE_TOKEN_USED", "This e-mail change link has already been used."],
        revoked: [409, "EMAIL_CHANGE_TOKEN_REVOKED", "This e-mail change link has been revoked."],
        expired: [410, "EMAIL_CHANGE_TOKEN_EXPIRED", "This e-mail change link has expired."]
    };
    const [status_, code, message] = states[status] || [
        409,
        "EMAIL_CHANGE_REQUEST_NOT_PENDING",
        "The e-mail change request is not pending."
    ];
    return applicationError(status_, code, message);
}

function publicEmailChangeRequest(row) {
    return {
        id: row.public_id,
        newEmail: row.new_email_normalized,
        status: row.status,
        expiresAt: row.expires_at
    };
}

function createAccountService({
    database,
    delivery = createAccountEmailDelivery(),
    now = () => new Date(),
    generatePublicId = createPublicId,
    generateEmailChangeToken = createEmailChangeToken,
    hashToken = hashEmailChangeToken
} = {}) {
    if (!database) {
        throw new TypeError("Account service requires a database.");
    }
    const sql = promiseDatabase(database);

    async function begin() {
        const connection = await sql.getConnection();
        try {
            await connection.beginTransaction();
            return connection;
        } catch (error) {
            connection.release();
            throw error;
        }
    }

    async function rollbackAndRelease(connection) {
        try {
            await connection.rollback();
        } finally {
            connection.release();
        }
    }

    async function compensateEmailChangeDeliveryFailure({ actorUserId, requestPublicId }) {
        const connection = await begin();
        let recovered = false;
        try {
            const [rows] = await connection.query(
                `SELECT id, status FROM user_email_change_requests
                 WHERE user_id = ? AND public_id = ? FOR UPDATE`,
                [actorUserId, requestPublicId]
            );
            if (rows[0]?.status === "pending") {
                const [updated] = await connection.query(
                    `UPDATE user_email_change_requests
                     SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP(3)
                     WHERE id = ? AND status = 'pending'`,
                    [rows[0].id]
                );
                if (updated.affectedRows === 1) {
                    recovered = true;
                }
            }
            await connection.commit();
        } catch (error) {
            await rollbackAndRelease(connection);
            throw error;
        }
        connection.release();
        return recovered;
    }

    async function changePassword(actorUserId, input) {
        // Pure input-shape check (no DB round trip, no bcrypt cost) settled
        // first, exactly as it would be by the validation layer if it had
        // access to the dedicated error code - this is a self-consistency
        // check on the submitted payload, unrelated to account state, so it
        // never needs a row lock and never leaks anything about the current
        // password.
        if (input.newPassword !== input.newPasswordConfirmation) {
            throw new PasswordConfirmationMismatchError();
        }

        const connection = await begin();
        try {
            const [rows] = await connection.query(
                "SELECT id, password_hash, auth_version FROM users WHERE id = ? FOR UPDATE",
                [actorUserId]
            );
            if (rows.length === 0) throw new NotFoundError("User not found.");
            const user = rows[0];

            const currentMatches = await bcrypt.compare(input.currentPassword, user.password_hash);
            if (!currentMatches) throw new CurrentPasswordInvalidError();

            const sameAsCurrent = await bcrypt.compare(input.newPassword, user.password_hash);
            if (sameAsCurrent) throw new NewPasswordSameAsCurrentError();

            const newHash = await bcrypt.hash(input.newPassword, PASSWORD_HASH_COST);
            const [updated] = await connection.query(
                `UPDATE users
                 SET password_hash = ?, password_changed_at = CURRENT_TIMESTAMP(3),
                     auth_version = auth_version + 1
                 WHERE id = ? AND auth_version = ?`,
                [newHash, actorUserId, user.auth_version]
            );
            if (updated.affectedRows !== 1) {
                throw applicationError(
                    409,
                    "ACCOUNT_STATE_CHANGED",
                    "The account changed concurrently. Please try again."
                );
            }

            await connection.commit();
        } catch (error) {
            await rollbackAndRelease(connection);
            throw error;
        }
        connection.release();
        return { message: "Password changed successfully." };
    }

    async function requestEmailChange(actorUserId, input, { requestId, locale = "de" } = {}) {
        delivery.assertAvailable();
        const { token, tokenHash } = generateEmailChangeToken();
        const requestPublicId = generatePublicId();
        const expiresAt = new Date(now().getTime() + EMAIL_CHANGE_TOKEN_LIFETIME_MS);

        const connection = await begin();
        let oldEmail;
        try {
            const [userRows] = await connection.query(
                "SELECT id, email, password_hash FROM users WHERE id = ? FOR UPDATE",
                [actorUserId]
            );
            if (userRows.length === 0) throw new NotFoundError("User not found.");
            const user = userRows[0];
            oldEmail = user.email;

            const currentMatches = await bcrypt.compare(input.currentPassword, user.password_hash);
            if (!currentMatches) throw new CurrentPasswordInvalidError();

            if (input.newEmail === user.email.toLowerCase()) {
                throw new EmailUnchangedError();
            }

            // Early UX signal only - the unique index on users.email at
            // confirmation time is the actual, race-safe safety net (see
            // confirmEmailChange below), exactly as registration's own
            // pre-check + ER_DUP_ENTRY catch is only the first line of
            // defense, not the only one.
            const [conflicting] = await connection.query(
                "SELECT id FROM users WHERE email = ? AND id != ?",
                [input.newEmail, actorUserId]
            );
            if (conflicting.length > 0) throw new EmailAlreadyInUseError();

            const currentTime = now();
            const [pendingRows] = await connection.query(
                `SELECT id, expires_at FROM user_email_change_requests
                 WHERE user_id = ? AND status = 'pending' FOR UPDATE`,
                [actorUserId]
            );
            for (const pendingRow of pendingRows) {
                if (new Date(pendingRow.expires_at).getTime() <= currentTime.getTime()) {
                    await connection.query(
                        `UPDATE user_email_change_requests SET status = 'expired'
                         WHERE id = ? AND status = 'pending'`,
                        [pendingRow.id]
                    );
                } else {
                    await connection.query(
                        `UPDATE user_email_change_requests
                         SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP(3)
                         WHERE id = ? AND status = 'pending'`,
                        [pendingRow.id]
                    );
                }
            }

            await connection.query(
                `INSERT INTO user_email_change_requests (
                    public_id, user_id, new_email_normalized, token_hash, status, expires_at
                 ) VALUES (?, ?, ?, ?, 'pending', ?)`,
                [requestPublicId, actorUserId, input.newEmail, tokenHash, expiresAt]
            );

            await connection.commit();
        } catch (error) {
            await rollbackAndRelease(connection);
            if (error.code === "ER_DUP_ENTRY") {
                throw new EmailAlreadyInUseError();
            }
            throw error;
        }
        connection.release();

        let delivered;
        try {
            delivered = await delivery.sendConfirmation({
                token,
                newEmail: input.newEmail,
                expiresAt,
                locale,
                requestId
            });
        } catch {
            try {
                const recovered = await compensateEmailChangeDeliveryFailure({
                    actorUserId,
                    requestPublicId
                });
                if (!recovered) {
                    throw new Error("Email change request was no longer pending during delivery recovery.");
                }
            } catch (compensationError) {
                throw new AppError({
                    status: 503,
                    code: "EMAIL_CHANGE_DELIVERY_RECOVERY_FAILED",
                    message: "Email change delivery failed and requires operator review.",
                    cause: compensationError
                });
            }
            throw new AppError({
                status: 502,
                code: "EMAIL_CHANGE_DELIVERY_FAILED",
                message: "Email change delivery failed; the request was revoked safely."
            });
        }

        // Best-effort only: the SMTP provider already logs any failure of
        // this send internally (see smtpAccountEmailProvider.js). A failure
        // here must never affect the outcome of the request or revoke the
        // just-created, successfully-delivered confirmation request.
        try {
            await delivery.sendNotificationBestEffort({
                oldEmail,
                newEmail: input.newEmail,
                locale,
                requestId
            });
        } catch {
            // Swallowed by design - see comment above.
        }

        return {
            emailChangeRequest: {
                id: requestPublicId,
                newEmail: input.newEmail,
                status: "pending",
                expiresAt
            },
            delivery: delivered
        };
    }

    async function getCurrentEmailChangeRequest(actorUserId) {
        const [rows] = await sql.query(
            `SELECT id, public_id, new_email_normalized, status, expires_at
             FROM user_email_change_requests
             WHERE user_id = ? AND status = 'pending'
             ORDER BY id DESC LIMIT 1`,
            [actorUserId]
        );
        if (rows.length === 0) return { emailChangeRequest: null };
        const row = rows[0];
        if (new Date(row.expires_at).getTime() <= now().getTime()) {
            await sql.query(
                "UPDATE user_email_change_requests SET status = 'expired' WHERE id = ? AND status = 'pending'",
                [row.id]
            );
            return { emailChangeRequest: null };
        }
        return { emailChangeRequest: publicEmailChangeRequest(row) };
    }

    async function revokeEmailChangeRequest(actorUserId) {
        const connection = await begin();
        let postCommitError;
        try {
            const [rows] = await connection.query(
                `SELECT id, expires_at FROM user_email_change_requests
                 WHERE user_id = ? AND status = 'pending' FOR UPDATE`,
                [actorUserId]
            );
            if (rows.length === 0) throw new EmailChangeRequestNotFoundError();
            const row = rows[0];

            if (new Date(row.expires_at).getTime() <= now().getTime()) {
                await connection.query(
                    "UPDATE user_email_change_requests SET status = 'expired' WHERE id = ? AND status = 'pending'",
                    [row.id]
                );
                await connection.commit();
                postCommitError = new EmailChangeRequestNotFoundError();
            } else {
                const [updated] = await connection.query(
                    `UPDATE user_email_change_requests
                     SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP(3)
                     WHERE id = ? AND status = 'pending'`,
                    [row.id]
                );
                if (updated.affectedRows !== 1) throw new EmailChangeRequestNotFoundError();
                await connection.commit();
            }
        } catch (error) {
            await rollbackAndRelease(connection);
            throw error;
        }
        connection.release();
        if (postCommitError) throw postCommitError;
        return { message: "Email change request revoked." };
    }

    async function confirmEmailChange(token) {
        let tokenHash;
        try {
            tokenHash = hashToken(token);
        } catch {
            throw new EmailChangeTokenInvalidError();
        }

        const connection = await begin();
        let postCommitError;
        try {
            // Lock ordering: users before user_email_change_requests,
            // consistently with requestEmailChange above - the initial
            // lookup is unlocked purely to discover which user owns the
            // token, mirroring studioService.acceptInvitation's
            // peek-studio-then-lock-studio-then-lock-invitation sequence.
            const [references] = await connection.query(
                "SELECT user_id FROM user_email_change_requests WHERE token_hash = ? LIMIT 1",
                [tokenHash]
            );
            if (references.length === 0) throw new EmailChangeTokenInvalidError();

            const [userRows] = await connection.query(
                "SELECT id, auth_version FROM users WHERE id = ? FOR UPDATE",
                [references[0].user_id]
            );
            if (userRows.length === 0) throw new EmailChangeTokenInvalidError();
            const user = userRows[0];

            const [rows] = await connection.query(
                `SELECT id, new_email_normalized, status, expires_at
                 FROM user_email_change_requests
                 WHERE user_id = ? AND token_hash = ?
                 LIMIT 1 FOR UPDATE`,
                [user.id, tokenHash]
            );
            if (rows.length === 0) throw new EmailChangeTokenInvalidError();
            const request = rows[0];

            if (request.status !== "pending") {
                throw emailChangeRequestStateError(request.status);
            }

            if (new Date(request.expires_at).getTime() <= now().getTime()) {
                await connection.query(
                    "UPDATE user_email_change_requests SET status = 'expired' WHERE id = ?",
                    [request.id]
                );
                await connection.commit();
                postCommitError = emailChangeRequestStateError("expired");
            } else {
                // Re-checked immediately before the mutation, not just at
                // request time - closes the "e-mail race between two
                // users" gap the unique index on users.email would catch
                // anyway (see the ER_DUP_ENTRY catch below), but produces a
                // clearer error for the common non-race case.
                const [conflicting] = await connection.query(
                    "SELECT id FROM users WHERE email = ? AND id != ?",
                    [request.new_email_normalized, user.id]
                );
                if (conflicting.length > 0) throw new EmailAlreadyInUseError();

                const [updatedUser] = await connection.query(
                    `UPDATE users
                     SET email = ?, email_changed_at = CURRENT_TIMESTAMP(3),
                         auth_version = auth_version + 1
                     WHERE id = ? AND auth_version = ?`,
                    [request.new_email_normalized, user.id, user.auth_version]
                );
                if (updatedUser.affectedRows !== 1) {
                    throw applicationError(
                        409,
                        "ACCOUNT_STATE_CHANGED",
                        "The account changed concurrently. Please try again."
                    );
                }

                const [confirmed] = await connection.query(
                    `UPDATE user_email_change_requests
                     SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP(3)
                     WHERE id = ? AND status = 'pending'`,
                    [request.id]
                );
                if (confirmed.affectedRows !== 1) throw emailChangeRequestStateError("confirmed");

                await connection.commit();
            }
        } catch (error) {
            await rollbackAndRelease(connection);
            if (error.code === "ER_DUP_ENTRY") {
                throw new EmailAlreadyInUseError();
            }
            throw error;
        }
        connection.release();
        if (postCommitError) throw postCommitError;
        return { message: "Email address confirmed." };
    }

    return {
        changePassword,
        confirmEmailChange,
        getCurrentEmailChangeRequest,
        requestEmailChange,
        revokeEmailChangeRequest
    };
}

module.exports = { createAccountService };
