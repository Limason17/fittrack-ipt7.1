const test = require("node:test");
const assert = require("node:assert/strict");

const { maskIpForLogging, normalizeIp, resolveClientIp } = require("../../security/clientIp");

test("normalizeIp lowercases and trims a plain IPv4/IPv6 address", () => {
    assert.equal(normalizeIp(" 203.0.113.7 "), "203.0.113.7");
    assert.equal(normalizeIp("2001:DB8::1"), "2001:db8::1");
});

test("normalizeIp collapses an IPv4-mapped IPv6 address to plain IPv4", () => {
    assert.equal(normalizeIp("::ffff:203.0.113.7"), "203.0.113.7");
    assert.equal(normalizeIp("::FFFF:127.0.0.1"), "127.0.0.1");
});

test("normalizeIp strips an IPv6 zone id and brackets", () => {
    assert.equal(normalizeIp("fe80::1%eth0"), "fe80::1");
    assert.equal(normalizeIp("[::1]"), "::1");
});

test("normalizeIp never throws on garbage input and returns a stable sentinel", () => {
    assert.equal(normalizeIp(""), "unknown");
    assert.equal(normalizeIp(null), "unknown");
    assert.equal(normalizeIp(undefined), "unknown");
    assert.equal(normalizeIp(42), "unknown");
});

test("resolveClientIp prefers req.ip, then the raw socket address, and normalizes either", () => {
    assert.equal(resolveClientIp({ ip: "::ffff:198.51.100.9" }), "198.51.100.9");
    assert.equal(resolveClientIp({ socket: { remoteAddress: "198.51.100.9" } }), "198.51.100.9");
    assert.equal(resolveClientIp({ connection: { remoteAddress: "198.51.100.9" } }), "198.51.100.9");
    assert.equal(resolveClientIp({}), "unknown");
});

test("resolveClientIp never itself reads X-Forwarded-For - only whatever Express already put on req.ip", () => {
    // Express only populates req.ip from X-Forwarded-For when trust proxy is
    // explicitly configured (see config/proxyConfig.js) - this function must
    // never bypass that by looking at headers directly.
    const spoofed = {
        ip: "203.0.113.1",
        headers: { "x-forwarded-for": "1.2.3.4" },
        socket: { remoteAddress: "203.0.113.1" }
    };
    assert.equal(resolveClientIp(spoofed), "203.0.113.1");
});

test("maskIpForLogging truncates an IPv4 address to its /16 and an IPv6 address to its first two hextets", () => {
    assert.equal(maskIpForLogging("203.0.113.7"), "203.0.0.0/16");
    assert.equal(maskIpForLogging("2001:db8::1"), "2001:db8::/32");
    assert.equal(maskIpForLogging("unknown"), "unknown");
    assert.equal(maskIpForLogging(""), "unknown");
});

test("maskIpForLogging never reproduces the full original address", () => {
    const ip = "198.51.100.42";
    assert.notEqual(maskIpForLogging(ip), ip);
    assert.equal(maskIpForLogging(ip).includes("42"), false);
});
