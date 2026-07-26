const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

const TEST_DATABASE = `fittrack_api_test_authsession_${process.pid}_${Date.now()}`;
if (!/^fittrack_api_test_authsession_[A-Za-z0-9_]+$/.test(TEST_DATABASE)) {
    throw new Error("Refusing to use an unsafe auth-session test database name.");
}

process.env.NODE_ENV = "test";
process.env.DB_NAME = TEST_DATABASE;
process.env.JWT_SECRET = "fittrack-stage-3b2-test-secret-with-at-least-32-characters";
process.env.AUTH_LOGIN_RATE_LIMIT_MAX = "1000";
process.env.AUTH_REGISTRATION_RATE_LIMIT_MAX = "1000";
process.env.AUTH_PASSWORD_CHANGE_RATE_LIMIT_MAX = "1000";
process.env.AUTH_EMAIL_CHANGE_RATE_LIMIT_MAX = "1000";
process.env.AUTH_EMAIL_CHANGE_CONFIRM_RATE_LIMIT_MAX = "1000";
// Stage 3D: auth.refresh is keyed by client IP alone, and every request in
// this whole file originates from the same loopback address - without a
// generous override this file's own volume of legitimate refresh calls
// (not abuse) would trip the production-sized default (30/5min) long
// before the file finishes. auth.logoutAll is keyed per user, at much lower
// real risk, but is bumped too for the same reason.
process.env.AUTH_REFRESH_RATE_LIMIT_MAX = "1000";
process.env.AUTH_LOGOUT_ALL_RATE_LIMIT_MAX = "1000";
process.env.INVITATION_ACCEPT_BASE_URL = "http://127.0.0.1:4173";
process.env.CORS_ORIGIN = "http://127.0.0.1:4173";
process.env.INVITATION_EMAIL_PROVIDER = "";
process.env.AUTH_MAX_ACTIVE_SESSIONS = "3";

const db = require("../../config/db");
const { createMigrationRunner } = require("../../migrations/runner");
const { createApp, defaultRouters } = require("../../startup/app");

const capturedLogs = [];
const logger = {
    info(...args) { capturedLogs.push(args); },
    warn(...args) { capturedLogs.push(args); },
    error(...args) { capturedLogs.push(args); }
};
const runId = crypto.randomBytes(5).toString("hex");
let adminConnection;
let pool;
let server;
let baseUrl;
let counter = 0;

function fixture(name) {
    counter += 1;
    return {
        username: `s3b2-${name}-${counter}-${runId}`,
        email: `s3b2-${name}-${counter}-${runId}@example.test`,
        password: "correct horse battery staple s3b2"
    };
}

function parseSetCookies(response) {
    const raw = response.headers.getSetCookie
        ? response.headers.getSetCookie()
        : [response.headers.get("set-cookie")].filter(Boolean);
    const jar = {};
    for (const line of raw) {
        const [pair] = line.split(";");
        const idx = pair.indexOf("=");
        jar[pair.slice(0, idx)] = pair.slice(idx + 1);
    }
    return jar;
}

function cookieHeader(jar) {
    return Object.entries(jar).map(([name, value]) => `${name}=${value}`).join("; ");
}

async function apiRaw(path, { method = "GET", token, body, cookies, csrf, origin = "http://127.0.0.1:4173" } = {}) {
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (cookies) headers.Cookie = cookieHeader(cookies);
    if (csrf !== undefined) headers["X-CSRF-Token"] = csrf;
    if (origin !== null) headers.Origin = origin;
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await response.json();
    return { response, data, cookies: parseSetCookies(response) };
}

async function registerUser(name) {
    const user = fixture(name);
    const registered = await apiRaw("/api/users/register", {
        method: "POST",
        body: {
            username: user.username,
            email: user.email,
            password: user.password,
            language_preference: "de",
            weight_unit: "kg",
            distance_unit: "km"
        }
    });
    assert.equal(registered.response.status, 201, JSON.stringify(registered.data));
    return user;
}

async function login(user) {
    const result = await apiRaw("/api/users/login", {
        method: "POST",
        body: { email: user.email, password: user.password }
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    return {
        token: result.data.token,
        cookies: result.cookies,
        csrf: result.cookies.fittrack_csrf,
        userId: result.data.user.id
    };
}

async function registerAndLogin(name) {
    const user = await registerUser(name);
    const session = await login(user);
    return { ...user, ...session };
}

before(async () => {
    adminConnection = await mysql.createConnection(
        db.readDatabaseConfig(process.env, { includeDatabase: false })
    );
    await adminConnection.query(`CREATE DATABASE \`${TEST_DATABASE}\` CHARACTER SET utf8mb4`);
    const runner = createMigrationRunner({ pool: db, logger });
    await runner.migrate({ expectedDatabase: TEST_DATABASE });
    pool = db.promise();

    const app = createApp({
        readiness: { check: async () => ({ ready: true }) },
        logger,
        routers: defaultRouters({ database: pool })
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.closePool(db);
    if (adminConnection) {
        assert.match(TEST_DATABASE, /^fittrack_api_test_authsession_[A-Za-z0-9_]+$/);
        await adminConnection.query(`DROP DATABASE IF EXISTS \`${TEST_DATABASE}\``);
        await adminConnection.end();
    }
});

// ---- Login ----

test("a successful login creates a session, sets an HttpOnly refresh cookie and a readable CSRF cookie, and returns an access token", async () => {
    const user = await registerUser("login-success");
    const result = await apiRaw("/api/users/login", { method: "POST", body: { email: user.email, password: user.password } });
    assert.equal(result.response.status, 200);
    assert.equal(typeof result.data.token, "string");
    assert.ok(result.cookies.fittrack_refresh, "expected a fittrack_refresh cookie to be set");
    assert.ok(result.cookies.fittrack_csrf, "expected a fittrack_csrf cookie to be set");

    const setCookieHeaders = result.response.headers.getSetCookie();
    const refreshLine = setCookieHeaders.find((line) => line.startsWith("fittrack_refresh="));
    const csrfLine = setCookieHeaders.find((line) => line.startsWith("fittrack_csrf="));
    assert.match(refreshLine, /HttpOnly/i);
    assert.doesNotMatch(csrfLine, /HttpOnly/i);
});

test("the access token returned by login carries id, authVersion and sessionId claims", async () => {
    const jwt = require("jsonwebtoken");
    const user = await registerUser("login-claims");
    const result = await login(user);
    const payload = jwt.verify(result.token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    assert.equal(payload.id, result.userId);
    assert.equal(payload.authVersion, 1);
    assert.match(payload.sessionId, /^[0-9a-f-]{36}$/);
});

test("unknown e-mail and wrong password yield the exact same status/code, and bcrypt runs on both paths (structural, not timing-based)", async () => {
    const originalCompare = bcrypt.compare;
    const calls = [];
    bcrypt.compare = async (plain, hash) => {
        calls.push(hash);
        return originalCompare(plain, hash);
    };
    try {
        const user = await registerUser("timing");

        calls.length = 0;
        const wrongPassword = await apiRaw("/api/users/login", {
            method: "POST",
            body: { email: user.email, password: "definitely-wrong-password" }
        });
        assert.equal(wrongPassword.response.status, 401);
        assert.equal(wrongPassword.data.error.code, "AUTHENTICATION_REQUIRED");
        assert.equal(calls.length, 1, "the wrong-password path must run exactly one bcrypt.compare");
        const realUserHashUsed = calls[0];

        calls.length = 0;
        const unknownEmail = await apiRaw("/api/users/login", {
            method: "POST",
            body: { email: `no-such-user-${crypto.randomUUID()}@example.test`, password: "irrelevant-password" }
        });
        assert.equal(unknownEmail.response.status, 401);
        assert.equal(unknownEmail.data.error.code, "AUTHENTICATION_REQUIRED");
        assert.equal(unknownEmail.data.error.message, wrongPassword.data.error.message);
        assert.equal(calls.length, 1, "the unknown-user path must ALSO run exactly one bcrypt.compare (the dummy-hash contract)");
        const dummyHashUsed = calls[0];

        assert.notEqual(dummyHashUsed, realUserHashUsed, "the dummy hash must never be a real user's password hash");

        calls.length = 0;
        await apiRaw("/api/users/login", {
            method: "POST",
            body: { email: `also-no-such-user-${crypto.randomUUID()}@example.test`, password: "irrelevant" }
        });
        assert.equal(calls[0], dummyHashUsed, "the dummy hash must be the exact same value across requests, never regenerated per request");
    } finally {
        bcrypt.compare = originalCompare;
    }
});

test("logging in beyond AUTH_MAX_ACTIVE_SESSIONS evicts the oldest active session instead of rejecting the new login", async () => {
    const user = await registerUser("session-limit");
    const sessions = [];
    for (let i = 0; i < 4; i += 1) {
        sessions.push(await login(user));
    }
    // Limit is 3 (set via AUTH_MAX_ACTIVE_SESSIONS above) - the 4th login
    // must evict the 1st (oldest), leaving sessions 2-4 active.
    const first = await apiRaw("/api/users/me", { token: sessions[0].token });
    assert.equal(first.response.status, 401);
    assert.equal(first.data.error.code, "AUTH_SESSION_INVALIDATED");

    for (const session of sessions.slice(1)) {
        const stillValid = await apiRaw("/api/users/me", { token: session.token });
        assert.equal(stillValid.response.status, 200);
    }
});

test("no refresh token or CSRF token value ever appears in a JSON response body", async () => {
    const user = await registerAndLogin("no-leak-response");
    const refreshValue = user.cookies.fittrack_refresh;
    const csrfValue = user.cookies.fittrack_csrf;

    const refreshResult = await apiRaw("/api/auth/refresh", { method: "POST", cookies: user.cookies, csrf: user.csrf });
    assert.equal(refreshResult.response.status, 200);
    const serialized = JSON.stringify(refreshResult.data);
    assert.equal(serialized.includes(refreshValue), false);
    assert.equal(serialized.includes(csrfValue), false);
});

test("no refresh or CSRF token value ever appears in a captured log entry", async () => {
    capturedLogs.length = 0;
    const user = await registerAndLogin("no-leak-logs");
    await apiRaw("/api/auth/refresh", { method: "POST", cookies: user.cookies, csrf: user.csrf });
    const serializedLogs = JSON.stringify(capturedLogs);
    assert.equal(serializedLogs.includes(user.cookies.fittrack_refresh), false);
    assert.equal(serializedLogs.includes(user.cookies.fittrack_csrf), false);
});

// ---- Refresh ----

test("a successful refresh rotates the refresh token, returns a new access token with the same sessionId, and the old refresh token becomes unusable", async () => {
    const jwt = require("jsonwebtoken");
    const user = await registerAndLogin("refresh-success");
    const oldCookies = user.cookies;

    const refreshed = await apiRaw("/api/auth/refresh", { method: "POST", cookies: user.cookies, csrf: user.csrf });
    assert.equal(refreshed.response.status, 200);
    assert.equal(typeof refreshed.data.accessToken, "string");
    assert.equal(refreshed.data.token, undefined, "the refresh response must not additionally use the legacy `token` field name");

    const oldPayload = jwt.verify(user.token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    const newPayload = jwt.verify(refreshed.data.accessToken, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    assert.equal(newPayload.sessionId, oldPayload.sessionId);

    assert.ok(refreshed.cookies.fittrack_refresh, "refresh must set a NEW refresh cookie");
    assert.notEqual(refreshed.cookies.fittrack_refresh, oldCookies.fittrack_refresh);

    const replay = await apiRaw("/api/auth/refresh", { method: "POST", cookies: oldCookies, csrf: user.csrf });
    assert.equal(replay.response.status, 401);
    assert.equal(replay.data.error.code, "AUTH_REFRESH_REUSE_DETECTED");
});

test("replaying an already-rotated refresh token triggers reuse detection and invalidates the entire session, including the freshly issued access token", async () => {
    const user = await registerAndLogin("reuse-detect");
    const oldCookies = user.cookies;
    const refreshed = await apiRaw("/api/auth/refresh", { method: "POST", cookies: user.cookies, csrf: user.csrf });
    assert.equal(refreshed.response.status, 200);

    const replay = await apiRaw("/api/auth/refresh", { method: "POST", cookies: oldCookies, csrf: user.csrf });
    assert.equal(replay.response.status, 401);
    assert.equal(replay.data.error.code, "AUTH_REFRESH_REUSE_DETECTED");

    const newAccessTokenNowInvalid = await apiRaw("/api/users/me", { token: refreshed.data.accessToken });
    assert.equal(newAccessTokenNowInvalid.response.status, 401);
    assert.equal(newAccessTokenNowInvalid.data.error.code, "AUTH_SESSION_INVALIDATED");
});

test("two genuinely concurrent refresh calls with the same token: exactly one succeeds, no duplicate active successor", async () => {
    const user = await registerAndLogin("concurrent-refresh");
    const [first, second] = await Promise.all([
        apiRaw("/api/auth/refresh", { method: "POST", cookies: user.cookies, csrf: user.csrf }),
        apiRaw("/api/auth/refresh", { method: "POST", cookies: user.cookies, csrf: user.csrf })
    ]);
    const statuses = [first.response.status, second.response.status].sort();
    assert.deepEqual(statuses, [200, 401]);
    const failed = first.response.status === 401 ? first : second;
    assert.equal(failed.data.error.code, "AUTH_REFRESH_REUSE_DETECTED");

    const [[activeCount]] = await pool.query(
        `SELECT COUNT(*) AS total FROM user_refresh_tokens rt
         INNER JOIN user_auth_sessions s ON s.id = rt.session_id
         WHERE s.user_id = ? AND rt.status = 'active'`,
        [user.userId]
    );
    assert.equal(Number(activeCount.total), 0, "the reuse-detection compromise must leave zero active refresh tokens, never two");
});

test("an expired refresh token is rejected with AUTH_REFRESH_TOKEN_EXPIRED", async () => {
    const user = await registerAndLogin("refresh-expired");
    await pool.query(
        `UPDATE user_refresh_tokens rt
         INNER JOIN user_auth_sessions s ON s.id = rt.session_id
         SET rt.expires_at = DATE_SUB(NOW(), INTERVAL 1 DAY)
         WHERE s.user_id = ?`,
        [user.userId]
    );
    const result = await apiRaw("/api/auth/refresh", { method: "POST", cookies: user.cookies, csrf: user.csrf });
    assert.equal(result.response.status, 401);
    assert.equal(result.data.error.code, "AUTH_REFRESH_TOKEN_EXPIRED");
});

test("a revoked session's refresh token is rejected with AUTH_REFRESH_TOKEN_INVALID", async () => {
    const user = await registerAndLogin("refresh-revoked-session");
    await pool.query(
        `UPDATE user_auth_sessions SET status = 'revoked' WHERE user_id = ?`,
        [user.userId]
    );
    const result = await apiRaw("/api/auth/refresh", { method: "POST", cookies: user.cookies, csrf: user.csrf });
    assert.equal(result.response.status, 401);
    assert.equal(result.data.error.code, "AUTH_REFRESH_TOKEN_INVALID");
});

test("a refresh whose session auth_version snapshot no longer matches the user's current auth_version is rejected", async () => {
    const user = await registerAndLogin("refresh-wrong-authversion");
    await pool.query("UPDATE users SET auth_version = auth_version + 1 WHERE id = ?", [user.userId]);
    // Bumping auth_version directly (bypassing logoutAll) leaves the session
    // row's own snapshot stale without revoking it - proving the refresh
    // path independently checks authVersion, not just session status.
    const result = await apiRaw("/api/auth/refresh", { method: "POST", cookies: user.cookies, csrf: user.csrf });
    assert.equal(result.response.status, 401);
});

test("refresh with a missing refresh cookie is rejected", async () => {
    const user = await registerAndLogin("refresh-missing-cookie");
    const result = await apiRaw("/api/auth/refresh", {
        method: "POST",
        cookies: { fittrack_csrf: user.cookies.fittrack_csrf },
        csrf: user.csrf
    });
    assert.equal(result.response.status, 401);
    assert.equal(result.data.error.code, "AUTH_REFRESH_TOKEN_INVALID");
});

test("refresh with a wrong CSRF header is rejected with AUTH_CSRF_INVALID", async () => {
    const user = await registerAndLogin("refresh-wrong-csrf");
    const result = await apiRaw("/api/auth/refresh", {
        method: "POST",
        cookies: user.cookies,
        csrf: "completely-wrong-csrf-value-xx"
    });
    assert.equal(result.response.status, 403);
    assert.equal(result.data.error.code, "AUTH_CSRF_INVALID");
});

test("refresh with a missing Origin header is allowed (documented CLI/test exception)", async () => {
    const user = await registerAndLogin("refresh-no-origin");
    const result = await apiRaw("/api/auth/refresh", {
        method: "POST",
        cookies: user.cookies,
        csrf: user.csrf,
        origin: null
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
});

test("refresh from a disallowed Origin is rejected with AUTH_ORIGIN_NOT_ALLOWED", async () => {
    const user = await registerAndLogin("refresh-bad-origin");
    const result = await apiRaw("/api/auth/refresh", {
        method: "POST",
        cookies: user.cookies,
        csrf: user.csrf,
        origin: "http://evil.example"
    });
    assert.equal(result.response.status, 403);
    assert.equal(result.data.error.code, "AUTH_ORIGIN_NOT_ALLOWED");
});

// ---- Logout ----

test("logout revokes the current session; the access token is immediately invalid; a subsequent refresh is rejected", async () => {
    const user = await registerAndLogin("logout-current");

    const loggedOut = await apiRaw("/api/auth/logout", { method: "POST", token: user.token, cookies: user.cookies, csrf: user.csrf });
    assert.equal(loggedOut.response.status, 200);

    const meAfter = await apiRaw("/api/users/me", { token: user.token });
    assert.equal(meAfter.response.status, 401);
    assert.equal(meAfter.data.error.code, "AUTH_SESSION_INVALIDATED");

    const refreshAfter = await apiRaw("/api/auth/refresh", { method: "POST", cookies: user.cookies, csrf: user.csrf });
    assert.equal(refreshAfter.response.status, 401);
    assert.equal(refreshAfter.data.error.code, "AUTH_REFRESH_TOKEN_INVALID");

    // Logout is Bearer-authenticated (see authSessionRouter.js): once the
    // session is revoked, the SAME access token can no longer even
    // authenticate a second logout call. This still fails safely and
    // predictably - a stable, documented AUTH_SESSION_INVALIDATED, never a
    // crash or an ambiguous state - which is the actual "repeated logout is
    // safe" guarantee the task asks for once the token itself has died.
    const secondLogout = await apiRaw("/api/auth/logout", { method: "POST", token: user.token, cookies: user.cookies, csrf: user.csrf });
    assert.equal(secondLogout.response.status, 401);
    assert.equal(secondLogout.data.error.code, "AUTH_SESSION_INVALIDATED");
});

test("two truly concurrent logout calls sharing the same still-valid access token both complete safely, with no error and no contradictory state", async () => {
    const user = await registerAndLogin("logout-concurrent-double-click");
    const [first, second] = await Promise.all([
        apiRaw("/api/auth/logout", { method: "POST", token: user.token, cookies: user.cookies, csrf: user.csrf }),
        apiRaw("/api/auth/logout", { method: "POST", token: user.token, cookies: user.cookies, csrf: user.csrf })
    ]);
    // Both requests authenticate with the SAME token (issued before either
    // logout committed), so both must be accepted; revokeSession's own
    // `WHERE status = 'active'` guard makes the second call's DB write a
    // safe no-op rather than an error - this is the idempotency the task
    // means by "repeated logout is safe" for a genuinely concurrent call.
    assert.equal(first.response.status, 200, JSON.stringify(first.data));
    assert.equal(second.response.status, 200, JSON.stringify(second.data));

    const meAfter = await apiRaw("/api/users/me", { token: user.token });
    assert.equal(meAfter.response.status, 401);
});

test("logout-all invalidates every session for the user, but leaves other users' sessions untouched", async () => {
    const userA = await registerAndLogin("logout-all-a");
    const sessionA2 = await login(userA);
    const userB = await registerAndLogin("logout-all-b");

    const result = await apiRaw("/api/auth/logout-all", { method: "POST", token: userA.token, cookies: userA.cookies, csrf: userA.csrf });
    assert.equal(result.response.status, 200);

    const meA1 = await apiRaw("/api/users/me", { token: userA.token });
    const meA2 = await apiRaw("/api/users/me", { token: sessionA2.token });
    assert.equal(meA1.response.status, 401);
    assert.equal(meA2.response.status, 401);

    const meB = await apiRaw("/api/users/me", { token: userB.token });
    assert.equal(meB.response.status, 200, "another user's session must remain completely unaffected by logout-all");
});

// ---- Stage 3B1 integration ----

test("changing the password revokes every active session for the user", async () => {
    const user = await registerAndLogin("integration-password-change");
    const secondSession = await login(user);

    const changed = await apiRaw("/api/account/change-password", {
        method: "POST",
        token: user.token,
        body: {
            currentPassword: user.password,
            newPassword: "a-brand-new-integration-password-123",
            newPasswordConfirmation: "a-brand-new-integration-password-123"
        }
    });
    assert.equal(changed.response.status, 200, JSON.stringify(changed.data));

    const meOriginal = await apiRaw("/api/users/me", { token: user.token });
    const meSecond = await apiRaw("/api/users/me", { token: secondSession.token });
    assert.equal(meOriginal.response.status, 401);
    assert.equal(meSecond.response.status, 401);

    const refreshAfter = await apiRaw("/api/auth/refresh", { method: "POST", cookies: user.cookies, csrf: user.csrf });
    assert.equal(refreshAfter.response.status, 401);
});

test("a refresh racing immediately against a password change never leaves a contradictory partially-active session state", async () => {
    const user = await registerAndLogin("integration-race-password");

    const [refreshResult, changeResult] = await Promise.all([
        apiRaw("/api/auth/refresh", { method: "POST", cookies: user.cookies, csrf: user.csrf }),
        apiRaw("/api/account/change-password", {
            method: "POST",
            token: user.token,
            body: {
                currentPassword: user.password,
                newPassword: "a-race-condition-password-123",
                newPasswordConfirmation: "a-race-condition-password-123"
            }
        })
    ]);
    assert.equal(changeResult.response.status, 200, JSON.stringify(changeResult.data));

    // Regardless of which won the race, the account must end up in a
    // consistent state: the OLD access token must be dead either way.
    const meOldToken = await apiRaw("/api/users/me", { token: user.token });
    assert.equal(meOldToken.response.status, 401);

    if (refreshResult.response.status === 200) {
        // If refresh won the race and returned a new access token before the
        // password change committed, that access token must ALSO be dead
        // once the password change's session-revocation commits.
        const meNewToken = await apiRaw("/api/users/me", { token: refreshResult.data.accessToken });
        assert.equal(meNewToken.response.status, 401);
    }
});

function confirmTokenFromUrl(url) {
    return decodeURIComponent(new URL(url).pathname.split("/").pop());
}

test("confirming an e-mail change revokes every active session for the user, including sessions in a different browser", async () => {
    const user = await registerAndLogin("integration-email-change");
    const secondSession = await login(user);
    const newEmail = `s3b2-new-email-${crypto.randomUUID()}@example.test`;

    const requested = await apiRaw("/api/account/email-change-requests", {
        method: "POST",
        token: user.token,
        body: { currentPassword: user.password, newEmail }
    });
    assert.equal(requested.response.status, 201, JSON.stringify(requested.data));
    const confirmToken = confirmTokenFromUrl(requested.data.delivery.confirmUrl);

    // Confirmation is deliberately unauthenticated (the link is opened from
    // the new address, possibly in a browser with no FitTrack session at
    // all) - mirrors accountApi.test.js's own confirmation calls.
    const confirmed = await apiRaw("/api/account/email-change-confirmations", { method: "POST", body: { token: confirmToken } });
    assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.data));

    const meOriginal = await apiRaw("/api/users/me", { token: user.token });
    const meSecond = await apiRaw("/api/users/me", { token: secondSession.token });
    assert.equal(meOriginal.response.status, 401);
    assert.equal(meSecond.response.status, 401);
});

test("a refresh racing immediately against an e-mail change confirmation never leaves a contradictory partially-active session state", async () => {
    const user = await registerAndLogin("integration-race-email");
    const newEmail = `s3b2-race-email-${crypto.randomUUID()}@example.test`;
    const requested = await apiRaw("/api/account/email-change-requests", {
        method: "POST",
        token: user.token,
        body: { currentPassword: user.password, newEmail }
    });
    assert.equal(requested.response.status, 201, JSON.stringify(requested.data));
    const confirmToken = confirmTokenFromUrl(requested.data.delivery.confirmUrl);

    const [refreshResult, confirmResult] = await Promise.all([
        apiRaw("/api/auth/refresh", { method: "POST", cookies: user.cookies, csrf: user.csrf }),
        apiRaw("/api/account/email-change-confirmations", { method: "POST", body: { token: confirmToken } })
    ]);
    assert.equal(confirmResult.response.status, 200, JSON.stringify(confirmResult.data));

    const meOldToken = await apiRaw("/api/users/me", { token: user.token });
    assert.equal(meOldToken.response.status, 401);
    if (refreshResult.response.status === 200) {
        const meNewToken = await apiRaw("/api/users/me", { token: refreshResult.data.accessToken });
        assert.equal(meNewToken.response.status, 401);
    }
});

test("logout is CSRF/Origin protected exactly like refresh", async () => {
    const user = await registerAndLogin("logout-csrf");
    const wrongCsrf = await apiRaw("/api/auth/logout", { method: "POST", token: user.token, cookies: user.cookies, csrf: "wrong" });
    assert.equal(wrongCsrf.response.status, 403);
    assert.equal(wrongCsrf.data.error.code, "AUTH_CSRF_INVALID");

    const badOrigin = await apiRaw("/api/auth/logout", { method: "POST", token: user.token, cookies: user.cookies, csrf: user.csrf, origin: "http://evil.example" });
    assert.equal(badOrigin.response.status, 403);
    assert.equal(badOrigin.data.error.code, "AUTH_ORIGIN_NOT_ALLOWED");

    const stillWorks = await apiRaw("/api/users/me", { token: user.token });
    assert.equal(stillWorks.response.status, 200, "a rejected logout attempt must not have revoked the session");
});
