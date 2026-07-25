const crypto = require("node:crypto");
const { AppError } = require("../errors/AppError");
const {
    AuthCsrfInvalidError,
    AuthRefreshReuseDetectedError,
    AuthRefreshTokenExpiredError,
    AuthRefreshTokenInvalidError,
    AuthSessionLimitReachedError
} = require("../errors/SessionErrors");
const { createOpaqueToken, hashOpaqueToken, timingSafeHashesEqual } = require("../security/sessionTokens");
const { SESSION_CONFIG } = require("../config/sessionConfig");

function promiseDatabase(database) {
    return typeof database.promise === "function" ? database.promise() : database;
}

function createSessionService({
    database,
    config = SESSION_CONFIG,
    now = () => new Date(),
    generatePublicId = () => crypto.randomUUID(),
    generateOpaqueToken = createOpaqueToken,
    hashToken = hashOpaqueToken
} = {}) {
    if (!database) {
        throw new TypeError("Session service requires a database.");
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

    function refreshExpiryDate() {
        return new Date(now().getTime() + config.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
    }

    async function insertRefreshToken(connection, sessionInternalId) {
        const { token, tokenHash } = generateOpaqueToken();
        const { token: csrfToken, tokenHash: csrfTokenHash } = generateOpaqueToken();
        const publicId = generatePublicId();
        const expiresAt = refreshExpiryDate();
        await connection.query(
            `INSERT INTO user_refresh_tokens (
                public_id, session_id, token_hash, csrf_token_hash, status, expires_at
             ) VALUES (?, ?, ?, ?, 'active', ?)`,
            [publicId, sessionInternalId, tokenHash, csrfTokenHash, expiresAt]
        );
        return { token, csrfToken, expiresAt };
    }

    // Evicts the oldest active sessions for a user until at most
    // (maxActiveSessions - 1) remain, making room for exactly one new
    // session about to be created - a returning user logging in on a new
    // device is never locked out by their own history on other devices.
    // Called with the user row already locked FOR UPDATE by the caller.
    async function evictOldestSessionsIfAtLimit(connection, userId) {
        const [activeSessions] = await connection.query(
            `SELECT id FROM user_auth_sessions
             WHERE user_id = ? AND status = 'active'
             ORDER BY created_at ASC
             FOR UPDATE`,
            [userId]
        );
        const overLimitBy = activeSessions.length - config.maxActiveSessions + 1;
        if (overLimitBy <= 0) return;

        const toEvict = activeSessions.slice(0, overLimitBy).map((row) => row.id);
        const [evicted] = await connection.query(
            `UPDATE user_auth_sessions
             SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP(3), revocation_reason = 'session_limit'
             WHERE id IN (?) AND status = 'active'`,
            [toEvict]
        );
        if (evicted.affectedRows > 0) {
            await connection.query(
                `UPDATE user_refresh_tokens
                 SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP(3)
                 WHERE session_id IN (?) AND status = 'active'`,
                [toEvict]
            );
        }
        if (activeSessions.length - evicted.affectedRows + 1 > config.maxActiveSessions) {
            // Defensive only - the ORDER BY + FOR UPDATE above should make
            // this unreachable, but never silently exceed the configured cap.
            throw new AuthSessionLimitReachedError();
        }
    }

    // Full login-time session creation: evict-if-at-limit, create the
    // session row (auth_version snapshotted at start, per the task's own
    // requirement), and mint the session's first refresh/CSRF token pair.
    // Returns everything the caller (the login route) needs to sign an
    // access JWT and set cookies - it never signs the JWT itself, matching
    // the existing convention that token signing stays in routes/users.js.
    async function startSession(userId, { authVersion }) {
        const sessionPublicId = generatePublicId();
        const sessionExpiresAt = new Date(now().getTime() + config.refreshTokenTtlDays * 24 * 60 * 60 * 1000);

        const connection = await begin();
        let result;
        try {
            await evictOldestSessionsIfAtLimit(connection, userId);

            const [inserted] = await connection.query(
                `INSERT INTO user_auth_sessions (
                    public_id, user_id, auth_version, status, expires_at
                 ) VALUES (?, ?, ?, 'active', ?)`,
                [sessionPublicId, userId, authVersion, sessionExpiresAt]
            );
            const { token, csrfToken, expiresAt } = await insertRefreshToken(connection, inserted.insertId);

            result = {
                sessionId: sessionPublicId,
                refreshToken: token,
                csrfToken,
                refreshExpiresAt: expiresAt
            };
            await connection.commit();
        } catch (error) {
            await rollbackAndRelease(connection);
            throw error;
        }
        connection.release();
        return result;
    }

    // Rotates a presented refresh token: the currently active token for its
    // session is marked 'rotated' and linked to exactly one successor via
    // replaced_by_token_id, all under a FOR UPDATE lock on both the token
    // row and its session - two genuinely concurrent calls for the same
    // token can never both succeed. See createAuthenticateToken's session
    // check for why the *access*-token side of this collapses every
    // rejection cause into one error; here, unlike that path, distinct
    // codes for "invalid" vs. "expired" vs. "reuse detected" are
    // intentional (the refresh token is never presented by anyone but the
    // single client that already holds the cookie, so there is no
    // enumeration risk in being specific, and the distinction is
    // operationally useful).
    async function rotateRefreshToken(presentedToken, presentedCsrfToken) {
        let tokenHash;
        try {
            tokenHash = hashToken(presentedToken);
        } catch {
            throw new AuthRefreshTokenInvalidError();
        }
        let csrfHashToVerify;
        try {
            csrfHashToVerify = hashToken(presentedCsrfToken);
        } catch {
            throw new AuthCsrfInvalidError();
        }

        const connection = await begin();
        let transactionSettled = false;
        try {
            const [reference] = await connection.query(
                "SELECT session_id FROM user_refresh_tokens WHERE token_hash = ? LIMIT 1",
                [tokenHash]
            );
            if (reference.length === 0) throw new AuthRefreshTokenInvalidError();

            const [sessionRows] = await connection.query(
                `SELECT s.id AS session_internal_id, s.public_id AS session_public_id,
                        s.user_id, s.status AS session_status, s.expires_at AS session_expires_at,
                        s.auth_version AS session_auth_version, u.auth_version AS user_auth_version
                 FROM user_auth_sessions s
                 INNER JOIN users u ON u.id = s.user_id
                 WHERE s.id = ?
                 FOR UPDATE`,
                [reference[0].session_id]
            );
            if (sessionRows.length === 0) throw new AuthRefreshTokenInvalidError();
            const session = sessionRows[0];
            // Mirrors authMiddleware.js's sessionAuthVersionStale check: a
            // session's auth_version is a snapshot taken at login time (see
            // startSession above). If the user's auth_version has since
            // moved on (password/e-mail change, logout-all) but this
            // particular session row was not reached by that revocation for
            // any reason, refresh must still fail closed rather than
            // silently trusting a stale snapshot.
            if (Number(session.session_auth_version) !== Number(session.user_auth_version)) {
                throw new AuthRefreshTokenInvalidError();
            }

            const [tokenRows] = await connection.query(
                `SELECT id, status, expires_at, csrf_token_hash
                 FROM user_refresh_tokens
                 WHERE session_id = ? AND token_hash = ?
                 LIMIT 1 FOR UPDATE`,
                [session.session_internal_id, tokenHash]
            );
            if (tokenRows.length === 0) throw new AuthRefreshTokenInvalidError();
            const tokenRow = tokenRows[0];

            // CSRF is bound to this exact refresh-token row (not just a
            // cookie/header double-submit match, checked separately and
            // earlier by security/csrfGuard.js) - a request presenting a
            // valid refresh cookie but a CSRF value that does not match
            // what was issued alongside THIS token can never proceed, even
            // if it somehow passed the plain double-submit check.
            if (!timingSafeHashesEqual(csrfHashToVerify, tokenRow.csrf_token_hash)) {
                throw new AuthCsrfInvalidError();
            }

            if (tokenRow.status === "rotated") {
                // Reuse of an already-rotated token: compromise the whole
                // session, not just this one token - the legitimate
                // successor token is presumably already in the rightful
                // owner's cookie jar, so revoking everything forces a clean
                // re-login rather than leaving an attacker's stolen copy
                // (or a confused second copy of the legitimate client)
                // silently able to keep using a still-active successor.
                await connection.query(
                    `UPDATE user_auth_sessions
                     SET status = 'compromised', revoked_at = CURRENT_TIMESTAMP(3),
                         revocation_reason = 'refresh_reuse_detected'
                     WHERE id = ? AND status = 'active'`,
                    [session.session_internal_id]
                );
                await connection.query(
                    `UPDATE user_refresh_tokens
                     SET status = 'compromised', revoked_at = CURRENT_TIMESTAMP(3)
                     WHERE session_id = ? AND status = 'active'`,
                    [session.session_internal_id]
                );
                transactionSettled = true;
                await connection.commit();
                connection.release();
                throw new AuthRefreshReuseDetectedError();
            }
            if (tokenRow.status !== "active") {
                throw new AuthRefreshTokenInvalidError();
            }
            if (new Date(tokenRow.expires_at).getTime() <= now().getTime()) {
                throw new AuthRefreshTokenExpiredError();
            }
            if (session.session_status !== "active") {
                throw new AuthRefreshTokenInvalidError();
            }
            if (new Date(session.session_expires_at).getTime() <= now().getTime()) {
                throw new AuthRefreshTokenExpiredError();
            }

            const { token: newToken, csrfToken: newCsrfToken, expiresAt: newExpiresAt } =
                await insertRefreshToken(connection, session.session_internal_id);

            const [newTokenRows] = await connection.query(
                "SELECT id FROM user_refresh_tokens WHERE session_id = ? AND token_hash = ? LIMIT 1",
                [session.session_internal_id, hashToken(newToken)]
            );
            const newTokenInternalId = newTokenRows[0].id;

            const [rotated] = await connection.query(
                `UPDATE user_refresh_tokens
                 SET status = 'rotated', consumed_at = CURRENT_TIMESTAMP(3), replaced_by_token_id = ?
                 WHERE id = ? AND status = 'active'`,
                [newTokenInternalId, tokenRow.id]
            );
            if (rotated.affectedRows !== 1) {
                // Lost the race under our own FOR UPDATE lock - structurally
                // shouldn't happen, but never leave two active successors.
                throw new AuthRefreshTokenInvalidError();
            }

            await connection.query(
                "UPDATE user_auth_sessions SET last_seen_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
                [session.session_internal_id]
            );

            await connection.commit();
            connection.release();
            return {
                sessionId: session.session_public_id,
                userId: session.user_id,
                authVersion: session.user_auth_version,
                refreshToken: newToken,
                csrfToken: newCsrfToken,
                refreshExpiresAt: newExpiresAt
            };
        } catch (error) {
            // The reuse-detection branch above already committed and
            // released this exact connection before throwing - calling
            // rollback()/release() on it again here would operate on a
            // connection the pool may have ALREADY handed to a different,
            // genuinely concurrent caller (a real bug once found under the
            // "two concurrent refreshes" test: it corrupted the other
            // request's transaction). transactionSettled guards against
            // ever touching the connection again once that branch is taken.
            if (!transactionSettled) {
                await rollbackAndRelease(connection);
            }
            throw error;
        }
    }

    async function revokeSession(sessionPublicId, userId, reason) {
        const connection = await begin();
        try {
            const [rows] = await connection.query(
                `SELECT id FROM user_auth_sessions
                 WHERE public_id = ? AND user_id = ? AND status = 'active'
                 FOR UPDATE`,
                [sessionPublicId, userId]
            );
            if (rows.length > 0) {
                const sessionInternalId = rows[0].id;
                await connection.query(
                    `UPDATE user_auth_sessions
                     SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP(3), revocation_reason = ?
                     WHERE id = ?`,
                    [reason, sessionInternalId]
                );
                await connection.query(
                    `UPDATE user_refresh_tokens
                     SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP(3)
                     WHERE session_id = ? AND status = 'active'`,
                    [sessionInternalId]
                );
            }
            await connection.commit();
        } catch (error) {
            await rollbackAndRelease(connection);
            throw error;
        }
        connection.release();
    }

    // Revokes every active session for a user. Used by logout-all and, via
    // accountService.js, by password change and confirmed e-mail change -
    // always called with the SAME connection/transaction as the account
    // mutation in that case (see accountService.js), so the caller passes
    // an already-open connection instead of this function opening its own.
    async function revokeAllSessionsInTransaction(connection, userId, reason) {
        const [activeSessions] = await connection.query(
            `SELECT id FROM user_auth_sessions WHERE user_id = ? AND status = 'active' FOR UPDATE`,
            [userId]
        );
        if (activeSessions.length === 0) return;
        const sessionIds = activeSessions.map((row) => row.id);
        await connection.query(
            `UPDATE user_auth_sessions
             SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP(3), revocation_reason = ?
             WHERE id IN (?) AND status = 'active'`,
            [reason, sessionIds]
        );
        await connection.query(
            `UPDATE user_refresh_tokens
             SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP(3)
             WHERE session_id IN (?) AND status = 'active'`,
            [sessionIds]
        );
    }

    // Logout-all: revokes every session/refresh token for the user AND
    // atomically bumps auth_version, so even an access token whose
    // sessionId lookup somehow raced past the session-revocation write
    // (there should be none, thanks to FOR UPDATE, but this is the same
    // belt-and-suspenders the Stage 3B1 password/e-mail-change flows
    // already rely on) is still caught by the authVersion mismatch check in
    // authMiddleware.js. Password change and confirmed e-mail change
    // (accountService.js) already perform their own auth_version increment
    // as part of their existing Stage 3B1 transaction, so they call
    // revokeAllSessionsInTransaction directly on their own connection
    // instead of this function, to avoid bumping auth_version twice.
    async function logoutAll(userId, reason) {
        const connection = await begin();
        try {
            const [result] = await connection.query(
                "UPDATE users SET auth_version = auth_version + 1 WHERE id = ?",
                [userId]
            );
            if (result.affectedRows !== 1) {
                throw new AuthRefreshTokenInvalidError();
            }
            await revokeAllSessionsInTransaction(connection, userId, reason);
            await connection.commit();
        } catch (error) {
            await rollbackAndRelease(connection);
            throw error;
        }
        connection.release();
    }

    return {
        begin,
        rollbackAndRelease,
        logoutAll,
        revokeAllSessionsInTransaction,
        revokeSession,
        rotateRefreshToken,
        startSession
    };
}

module.exports = { createSessionService, timingSafeHashesEqual };
