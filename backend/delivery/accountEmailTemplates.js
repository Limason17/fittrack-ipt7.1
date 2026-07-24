const SUPPORTED_LOCALES = new Set(["de", "en"]);

const CONFIRMATION_COPY = Object.freeze({
    de: {
        subject: "Bestätige deine neue E-Mail-Adresse auf FitTrack",
        greeting: "Hallo,",
        body: () =>
            "du hast angefordert, die E-Mail-Adresse deines FitTrack-Kontos auf diese Adresse zu ändern.",
        actionText: "E-Mail-Adresse bestätigen",
        expiresPrefix: "Dieser Bestätigungslink ist gültig bis",
        ignoreHint: "Falls du diese Änderung nicht angefordert hast, kannst du diese E-Mail ignorieren. Deine aktuelle E-Mail-Adresse bleibt bis zur Bestätigung unverändert.",
        signOff: "FitTrack",
        linkFallback: "Falls die Schaltfläche nicht funktioniert, kopiere diesen Link in deinen Browser:"
    },
    en: {
        subject: "Confirm your new e-mail address on FitTrack",
        greeting: "Hello,",
        body: () =>
            "you requested to change your FitTrack account's e-mail address to this address.",
        actionText: "Confirm e-mail address",
        expiresPrefix: "This confirmation link is valid until",
        ignoreHint: "If you did not request this change, you can safely ignore this e-mail. Your current e-mail address remains unchanged until confirmed.",
        signOff: "FitTrack",
        linkFallback: "If the button does not work, copy this link into your browser:"
    }
});

const NOTICE_COPY = Object.freeze({
    de: {
        subject: "Änderung deiner E-Mail-Adresse wurde angefordert",
        greeting: "Hallo,",
        body: (newEmail) =>
            `für dein FitTrack-Konto wurde eine Änderung der E-Mail-Adresse zu "${newEmail}" angefordert.`,
        ignoreHint: "Falls du das nicht warst, ändere umgehend dein Passwort und kontaktiere den Support - diese E-Mail-Adresse bleibt so lange gültig, bis die Änderung bestätigt wird.",
        signOff: "FitTrack"
    },
    en: {
        subject: "A change to your e-mail address was requested",
        greeting: "Hello,",
        body: (newEmail) =>
            `a change of your FitTrack account's e-mail address to "${newEmail}" was requested.`,
        ignoreHint: "If this was not you, change your password immediately and contact support - this e-mail address remains valid until the change is confirmed.",
        signOff: "FitTrack"
    }
});

function resolveLocale(locale) {
    return SUPPORTED_LOCALES.has(locale) ? locale : "de";
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatExpiry(expiresAt, locale) {
    const date = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "de-CH", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC"
    }).format(date);
}

function simpleHtmlLayout({ greeting, paragraphs, actionText, actionUrl, linkFallback }) {
    const safeGreeting = escapeHtml(greeting);
    const safeParagraphs = paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n              ");
    const actionBlock = actionUrl
        ? `<p style="text-align:center;margin:28px 0;">
                <a href="${escapeHtml(actionUrl)}" style="background-color:#1f6f50;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;display:inline-block;">${escapeHtml(actionText)}</a>
              </p>
              <p style="font-size:13px;color:#52606d;">${escapeHtml(linkFallback)}<br>
                <a href="${escapeHtml(actionUrl)}" style="color:#1f6f50;word-break:break-all;">${escapeHtml(actionUrl)}</a>
              </p>`
        : "";
    return `<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2933;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;padding:32px;">
          <tr>
            <td style="font-size:16px;line-height:1.5;">
              <p>${safeGreeting}</p>
              ${safeParagraphs}
              ${actionBlock}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Sent to the new address only. Contains no account data beyond the fact
// that a change was requested, the confirmation link, and an expiry hint -
// no current e-mail, no username, no internal IDs.
function buildEmailChangeConfirmationEmail({ confirmUrl, expiresAt, locale }) {
    if (typeof confirmUrl !== "string" || !confirmUrl.trim()) {
        throw new TypeError("buildEmailChangeConfirmationEmail requires a confirmation URL.");
    }
    const resolvedLocale = resolveLocale(locale);
    const copy = CONFIRMATION_COPY[resolvedLocale];
    const expiryText = formatExpiry(expiresAt, resolvedLocale);

    const textLines = [
        copy.greeting,
        "",
        copy.body(),
        "",
        `${copy.actionText}: ${confirmUrl}`,
        ...(expiryText ? ["", `${copy.expiresPrefix} ${expiryText}.`] : []),
        "",
        copy.ignoreHint,
        "",
        copy.signOff
    ];

    const paragraphs = [copy.body(), ...(expiryText ? [`${copy.expiresPrefix} ${expiryText}.`] : []), copy.ignoreHint, copy.signOff];

    return {
        subject: copy.subject,
        text: textLines.join("\n"),
        html: simpleHtmlLayout({
            greeting: copy.greeting,
            paragraphs,
            actionText: copy.actionText,
            actionUrl: confirmUrl,
            linkFallback: copy.linkFallback
        })
    };
}

// Best-effort security notice sent to the OLD address so the account owner
// learns of the request even if they never open the new inbox. Contains no
// token, no confirmation link, no new-email-ownership proof requirement -
// it is purely informational.
function buildEmailChangeNotificationEmail({ newEmail, locale }) {
    if (typeof newEmail !== "string" || !newEmail.trim()) {
        throw new TypeError("buildEmailChangeNotificationEmail requires the requested new e-mail address.");
    }
    const resolvedLocale = resolveLocale(locale);
    const copy = NOTICE_COPY[resolvedLocale];

    const textLines = [copy.greeting, "", copy.body(newEmail), "", copy.ignoreHint, "", copy.signOff];
    const paragraphs = [copy.body(newEmail), copy.ignoreHint, copy.signOff];

    return {
        subject: copy.subject,
        text: textLines.join("\n"),
        html: simpleHtmlLayout({ greeting: copy.greeting, paragraphs, actionText: "", actionUrl: "", linkFallback: "" })
    };
}

module.exports = {
    buildEmailChangeConfirmationEmail,
    buildEmailChangeNotificationEmail,
    escapeHtml,
    resolveLocale
};
