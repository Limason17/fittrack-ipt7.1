const test = require("node:test");
const assert = require("node:assert/strict");

const { readProxyConfig } = require("../../config/proxyConfig");

test("defaults to disabled with zero hops when unset", () => {
    assert.deepEqual(readProxyConfig({}), { mode: "disabled", hops: 0 });
});

test("production requires TRUST_PROXY_MODE to be set explicitly", () => {
    assert.throws(
        () => readProxyConfig({ NODE_ENV: "production" }),
        (error) => error.code === "INVALID_PROXY_CONFIG"
    );
    assert.deepEqual(
        readProxyConfig({ NODE_ENV: "production", TRUST_PROXY_MODE: "disabled" }),
        { mode: "disabled", hops: 0 }
    );
});

test("rejects an unknown TRUST_PROXY_MODE value", () => {
    assert.throws(
        () => readProxyConfig({ TRUST_PROXY_MODE: "always" }),
        (error) => error.code === "INVALID_PROXY_CONFIG"
    );
});

test("mode=hops requires an explicit, bounded TRUST_PROXY_HOPS", () => {
    assert.deepEqual(readProxyConfig({ TRUST_PROXY_MODE: "hops", TRUST_PROXY_HOPS: "1" }), { mode: "hops", hops: 1 });
    assert.deepEqual(readProxyConfig({ TRUST_PROXY_MODE: "hops", TRUST_PROXY_HOPS: "10" }), { mode: "hops", hops: 10 });
    for (const bad of [undefined, "0", "-1", "11", "all", "true"]) {
        assert.throws(
            () => readProxyConfig({ TRUST_PROXY_MODE: "hops", TRUST_PROXY_HOPS: bad }),
            (error) => error.code === "INVALID_PROXY_CONFIG",
            `expected TRUST_PROXY_HOPS=${bad} to be rejected under mode=hops`
        );
    }
});

test("mode=disabled rejects a nonzero TRUST_PROXY_HOPS rather than silently ignoring it", () => {
    assert.throws(
        () => readProxyConfig({ TRUST_PROXY_MODE: "disabled", TRUST_PROXY_HOPS: "3" }),
        (error) => error.code === "INVALID_PROXY_CONFIG"
    );
    assert.deepEqual(
        readProxyConfig({ TRUST_PROXY_MODE: "disabled", TRUST_PROXY_HOPS: "0" }),
        { mode: "disabled", hops: 0 }
    );
});

test("a hop count alone, without an explicit hops mode, never silently enables proxy trust", () => {
    assert.deepEqual(readProxyConfig({ TRUST_PROXY_HOPS: "0" }), { mode: "disabled", hops: 0 });
    assert.throws(
        () => readProxyConfig({ TRUST_PROXY_HOPS: "2" }),
        (error) => error.code === "INVALID_PROXY_CONFIG"
    );
});
