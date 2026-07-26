// IPv4-mapped IPv6 (e.g. "::ffff:127.0.0.1", as Node reports for an IPv4
// peer on a dual-stack socket) must collapse to the same normalized value as
// the plain IPv4 form - otherwise the same client could occupy two separate
// rate-limit buckets, or show up as two different log identities, depending
// on which stack accepted the connection.
const IPV4_MAPPED_PREFIX = "::ffff:";

function normalizeIp(rawIp) {
    if (typeof rawIp !== "string" || !rawIp) {
        return "unknown";
    }
    let ip = rawIp.trim().toLowerCase();
    if (ip.startsWith(IPV4_MAPPED_PREFIX) && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip.slice(IPV4_MAPPED_PREFIX.length))) {
        ip = ip.slice(IPV4_MAPPED_PREFIX.length);
    }
    // IPv6 zone IDs (RFC 4007, e.g. "fe80::1%eth0") and bracketed
    // "[::1]:1234"-style values are stripped to their bare address form -
    // neither carries additional client-identifying value here and both
    // would otherwise fragment one client's identity across variants.
    ip = ip.replace(/%.*$/, "");
    if (ip.startsWith("[") && ip.includes("]")) {
        ip = ip.slice(1, ip.indexOf("]"));
    }
    return ip || "unknown";
}

// Express only trusts (and therefore only reflects into req.ip/req.ips) an
// X-Forwarded-For entry when `app.set('trust proxy', ...)` is explicitly
// configured - see startup/app.js's use of config/proxyConfig.js. With trust
// proxy disabled (the default everywhere except an explicitly configured
// production deployment - see Section 12), req.ip is always the raw TCP
// peer address and no client-supplied header can influence it, so a
// malicious client cannot spoof another IP's rate-limit bucket or log
// identity by sending its own X-Forwarded-For. This function never reads
// the header itself; it only normalizes whatever Express already decided
// was authoritative.
function resolveClientIp(req) {
    const raw = req?.ip || req?.socket?.remoteAddress || req?.connection?.remoteAddress || "";
    return normalizeIp(raw);
}

// For logs and any other place a client IP might be displayed: never the
// full address, only enough to be useful for coarse abuse triage (Section
// 18 forbids logging a raw IP). IPv4 keeps its first two octets; IPv6 keeps
// its first two hextets. This is deliberately lossy and not reversible to
// the exact address.
function maskIpForLogging(normalizedIp) {
    if (typeof normalizedIp !== "string" || !normalizedIp || normalizedIp === "unknown") {
        return "unknown";
    }
    if (normalizedIp.includes(":")) {
        const parts = normalizedIp.split(":");
        return `${parts.slice(0, 2).join(":")}::/32`;
    }
    const octets = normalizedIp.split(".");
    if (octets.length === 4) {
        return `${octets[0]}.${octets[1]}.0.0/16`;
    }
    return "unknown";
}

module.exports = { maskIpForLogging, normalizeIp, resolveClientIp };
