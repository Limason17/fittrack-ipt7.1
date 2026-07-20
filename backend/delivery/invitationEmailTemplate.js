const SUPPORTED_LOCALES = new Set(["de", "en"]);

const ROLE_LABELS = Object.freeze({
    de: Object.freeze({ owner: "Eigentümer:in", admin: "Administration", trainer: "Trainer:in", member: "Mitglied" }),
    en: Object.freeze({ owner: "Owner", admin: "Administrator", trainer: "Trainer", member: "Member" })
});

const COPY = Object.freeze({
    de: {
        subject: (studioName) => `Einladung zu ${studioName} auf FitTrack`,
        greeting: "Hallo,",
        invited: (studioName, roleLabel) =>
            `du wurdest eingeladen, dem Studio "${studioName}" auf FitTrack als ${roleLabel} beizutreten.`,
        actionText: "Einladung annehmen",
        expiresPrefix: "Diese Einladung ist gültig bis",
        ignoreHint: "Falls du diese Einladung nicht erwartet hast, kannst du diese E-Mail ignorieren.",
        signOff: "FitTrack",
        linkFallback: "Falls die Schaltfläche nicht funktioniert, kopiere diesen Link in deinen Browser:"
    },
    en: {
        subject: (studioName) => `Invitation to ${studioName} on FitTrack`,
        greeting: "Hello,",
        invited: (studioName, roleLabel) =>
            `you have been invited to join the studio "${studioName}" on FitTrack as ${roleLabel}.`,
        actionText: "Accept invitation",
        expiresPrefix: "This invitation is valid until",
        ignoreHint: "If you did not expect this invitation, you can safely ignore this e-mail.",
        signOff: "FitTrack",
        linkFallback: "If the button does not work, copy this link into your browser:"
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

// Builds a minimal, plain, non-marketing invitation e-mail. Contains at most
// the studio name, the invited role, the acceptance URL, an expiry hint, and
// a "safe to ignore" note - no member data beyond the recipient address
// (which the caller supplies separately as the envelope/header recipient,
// never embedded in the body), no internal IDs, no tracking pixel, no
// externally loaded assets, no script.
function buildInvitationEmail({ studioName, role, acceptanceUrl, expiresAt, locale }) {
    if (typeof studioName !== "string" || !studioName.trim()) {
        throw new TypeError("buildInvitationEmail requires a studio name.");
    }
    if (typeof acceptanceUrl !== "string" || !acceptanceUrl.trim()) {
        throw new TypeError("buildInvitationEmail requires an acceptance URL.");
    }
    const resolvedLocale = resolveLocale(locale);
    const copy = COPY[resolvedLocale];
    const roleLabel = ROLE_LABELS[resolvedLocale][role] || role;
    const expiryText = formatExpiry(expiresAt, resolvedLocale);

    const subject = copy.subject(studioName);

    const textLines = [
        copy.greeting,
        "",
        copy.invited(studioName, roleLabel),
        "",
        `${copy.actionText}: ${acceptanceUrl}`,
        ...(expiryText ? ["", `${copy.expiresPrefix} ${expiryText}.`] : []),
        "",
        copy.ignoreHint,
        "",
        copy.signOff
    ];
    const text = textLines.join("\n");

    const safeStudioName = escapeHtml(studioName);
    const safeRoleLabel = escapeHtml(roleLabel);
    const safeAcceptanceUrl = escapeHtml(acceptanceUrl);
    const safeExpiryText = escapeHtml(expiryText);

    const html = `<!doctype html>
<html lang="${resolvedLocale}">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2933;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;padding:32px;">
          <tr>
            <td style="font-size:16px;line-height:1.5;">
              <p>${escapeHtml(copy.greeting)}</p>
              <p>${copy.invited(safeStudioName, safeRoleLabel)}</p>
              <p style="text-align:center;margin:28px 0;">
                <a href="${safeAcceptanceUrl}" style="background-color:#1f6f50;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;display:inline-block;">${escapeHtml(copy.actionText)}</a>
              </p>
              <p style="font-size:13px;color:#52606d;">${escapeHtml(copy.linkFallback)}<br>
                <a href="${safeAcceptanceUrl}" style="color:#1f6f50;word-break:break-all;">${safeAcceptanceUrl}</a>
              </p>
              ${safeExpiryText ? `<p style="font-size:13px;color:#52606d;">${escapeHtml(copy.expiresPrefix)} ${safeExpiryText}.</p>` : ""}
              <p style="font-size:13px;color:#52606d;">${escapeHtml(copy.ignoreHint)}</p>
              <p style="margin-top:24px;">${escapeHtml(copy.signOff)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    return { subject, text, html };
}

module.exports = {
    buildInvitationEmail,
    escapeHtml,
    resolveLocale
};
