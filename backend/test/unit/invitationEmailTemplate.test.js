const test = require("node:test");
const assert = require("node:assert/strict");

const { buildInvitationEmail, escapeHtml } = require("../../delivery/invitationEmailTemplate");

const BASE_MESSAGE = {
    studioName: "Bergsee Fitness",
    role: "trainer",
    acceptanceUrl: "https://app.fittrack.test/invitations/abc123",
    expiresAt: new Date("2026-08-01T12:00:00Z"),
    locale: "de"
};

test("produces both a text and an HTML version", () => {
    const email = buildInvitationEmail(BASE_MESSAGE);
    assert.equal(typeof email.subject, "string");
    assert.ok(email.subject.length > 0);
    assert.equal(typeof email.text, "string");
    assert.ok(email.text.includes(BASE_MESSAGE.acceptanceUrl));
    assert.equal(typeof email.html, "string");
    assert.ok(email.html.includes(BASE_MESSAGE.acceptanceUrl));
});

test("the text version always contains the full acceptance URL", () => {
    const email = buildInvitationEmail(BASE_MESSAGE);
    assert.ok(email.text.includes("https://app.fittrack.test/invitations/abc123"));
});

test("HTML-escapes a studio name so it cannot execute as HTML", () => {
    const email = buildInvitationEmail({
        ...BASE_MESSAGE,
        studioName: '<img src=x onerror=alert(1)>"Studio"'
    });
    assert.equal(email.html.includes("<img src=x onerror=alert(1)>"), false);
    assert.match(email.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(email.html, /&quot;Studio&quot;/);
});

test("escapeHtml escapes every reserved character", () => {
    assert.equal(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
});

test("contains no tracking pixel or externally loaded image", () => {
    const email = buildInvitationEmail(BASE_MESSAGE);
    assert.equal(/<img/i.test(email.html), false);
});

test("contains no script tag or inline event handler", () => {
    const email = buildInvitationEmail(BASE_MESSAGE);
    assert.equal(/<script/i.test(email.html), false);
    assert.equal(/\son\w+\s*=/i.test(email.html), false);
});

test("contains no externally loaded font or stylesheet reference", () => {
    const email = buildInvitationEmail(BASE_MESSAGE);
    assert.equal(/@import|<link|fonts\.googleapis|fonts\.gstatic/i.test(email.html), false);
});

test("contains the invited role label, not the raw role code, for a known role", () => {
    const email = buildInvitationEmail({ ...BASE_MESSAGE, role: "trainer", locale: "de" });
    assert.match(email.text, /Trainer:in/);
    const en = buildInvitationEmail({ ...BASE_MESSAGE, role: "trainer", locale: "en" });
    assert.match(en.text, /Trainer\b/);
});

test("falls back to a documented neutral default locale (German) when no locale is provided", () => {
    const noLocale = buildInvitationEmail({ ...BASE_MESSAGE, locale: undefined });
    const german = buildInvitationEmail({ ...BASE_MESSAGE, locale: "de" });
    assert.equal(noLocale.subject, german.subject);
});

test("falls back to German for an unsupported/unsafe locale value instead of inventing one", () => {
    const email = buildInvitationEmail({ ...BASE_MESSAGE, locale: "fr" });
    const german = buildInvitationEmail({ ...BASE_MESSAGE, locale: "de" });
    assert.equal(email.subject, german.subject);
});

test("subject line is plain and contains no sensitive data", () => {
    const email = buildInvitationEmail(BASE_MESSAGE);
    assert.equal(/@/.test(email.subject), false);
});

test("contains an expiry hint when expiresAt is provided", () => {
    const email = buildInvitationEmail(BASE_MESSAGE);
    assert.match(email.text, /2026/);
    assert.match(email.html, /2026/);
});

test("omits the expiry line gracefully when expiresAt is missing", () => {
    const email = buildInvitationEmail({ ...BASE_MESSAGE, expiresAt: undefined });
    assert.doesNotThrow(() => email);
});

test("throws for a missing studio name or acceptance URL instead of sending a broken e-mail", () => {
    assert.throws(() => buildInvitationEmail({ ...BASE_MESSAGE, studioName: "" }), TypeError);
    assert.throws(() => buildInvitationEmail({ ...BASE_MESSAGE, acceptanceUrl: "" }), TypeError);
});
