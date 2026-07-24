const test = require("node:test");
const assert = require("node:assert/strict");

const {
    buildEmailChangeConfirmationEmail,
    buildEmailChangeNotificationEmail,
    escapeHtml
} = require("../../delivery/accountEmailTemplates");

const CONFIRMATION_MESSAGE = {
    confirmUrl: "https://app.fittrack.test/account/email-change/abc123",
    expiresAt: new Date("2026-08-01T12:00:00Z"),
    locale: "de"
};

test("confirmation e-mail produces both a text and an HTML version containing the confirm URL", () => {
    const email = buildEmailChangeConfirmationEmail(CONFIRMATION_MESSAGE);
    assert.equal(typeof email.subject, "string");
    assert.ok(email.subject.length > 0);
    assert.ok(email.text.includes(CONFIRMATION_MESSAGE.confirmUrl));
    assert.ok(email.html.includes(CONFIRMATION_MESSAGE.confirmUrl));
});

test("confirmation e-mail contains an expiry hint when expiresAt is provided", () => {
    const email = buildEmailChangeConfirmationEmail(CONFIRMATION_MESSAGE);
    assert.match(email.text, /2026/);
    assert.match(email.html, /2026/);
});

test("confirmation e-mail omits the expiry line gracefully when expiresAt is missing", () => {
    assert.doesNotThrow(() => buildEmailChangeConfirmationEmail({ ...CONFIRMATION_MESSAGE, expiresAt: undefined }));
});

test("confirmation e-mail throws for a missing confirm URL instead of sending a broken e-mail", () => {
    assert.throws(() => buildEmailChangeConfirmationEmail({ ...CONFIRMATION_MESSAGE, confirmUrl: "" }), TypeError);
});

test("confirmation e-mail falls back to German for an unsupported locale", () => {
    const email = buildEmailChangeConfirmationEmail({ ...CONFIRMATION_MESSAGE, locale: "fr" });
    const german = buildEmailChangeConfirmationEmail({ ...CONFIRMATION_MESSAGE, locale: "de" });
    assert.equal(email.subject, german.subject);
});

test("confirmation e-mail contains no tracking pixel, script, or externally loaded asset", () => {
    const email = buildEmailChangeConfirmationEmail(CONFIRMATION_MESSAGE);
    assert.equal(/<img/i.test(email.html), false);
    assert.equal(/<script/i.test(email.html), false);
    assert.equal(/\son\w+\s*=/i.test(email.html), false);
    assert.equal(/@import|<link|fonts\.googleapis|fonts\.gstatic/i.test(email.html), false);
});

test("confirmation e-mail never mentions a current/old e-mail address, only the confirm link", () => {
    const email = buildEmailChangeConfirmationEmail(CONFIRMATION_MESSAGE);
    assert.equal(email.text.includes("old"), false);
});

test("notification e-mail includes the requested new address and HTML-escapes it", () => {
    const email = buildEmailChangeNotificationEmail({
        newEmail: '<img src=x onerror=alert(1)>@example.test',
        locale: "de"
    });
    assert.ok(email.text.includes("<img src=x onerror=alert(1)>@example.test"));
    assert.equal(email.html.includes("<img src=x onerror=alert(1)>"), false);
    assert.match(email.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("notification e-mail contains no confirmation link or token", () => {
    const email = buildEmailChangeNotificationEmail({ newEmail: "new@example.test", locale: "de" });
    assert.equal(/https?:\/\//.test(email.text), false);
    assert.equal(/https?:\/\//.test(email.html), false);
});

test("notification e-mail throws for a missing new e-mail address", () => {
    assert.throws(() => buildEmailChangeNotificationEmail({ newEmail: "", locale: "de" }), TypeError);
});

test("escapeHtml escapes every reserved character", () => {
    assert.equal(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
});
