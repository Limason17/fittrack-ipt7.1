const test = require("node:test");
const assert = require("node:assert/strict");

const { evaluatePublishConsistency } = require("../../scripts/encryptedBackupRemoteUpload");

const EXPECTED = Object.freeze({
    expectedBytes: 12345,
    expectedCiphertextSha256: "a".repeat(64),
    expectedKeyId: "prod-key-2026"
});

function consistentHead(overrides = {}) {
    return {
        VersionId: "v1",
        ContentLength: EXPECTED.expectedBytes,
        Metadata: {
            "ciphertext-sha256": EXPECTED.expectedCiphertextSha256,
            "key-id": EXPECTED.expectedKeyId
        },
        ...overrides
    };
}

test("a matching HeadObject on a versioned bucket is consistent and ownership-confirmed", () => {
    const result = evaluatePublishConsistency({
        uploadResult: { versionId: "v1", etag: "\"abc\"" },
        head: consistentHead(),
        ...EXPECTED
    });
    assert.deepEqual(result, { consistent: true, ownershipConfirmed: true });
});

test("a matching HeadObject on an unversioned bucket is consistent but ownership is not confirmed", () => {
    const result = evaluatePublishConsistency({
        uploadResult: { versionId: null, etag: "\"abc\"" },
        head: consistentHead({ VersionId: undefined }),
        ...EXPECTED
    });
    assert.deepEqual(result, { consistent: true, ownershipConfirmed: false });
});

test("a size mismatch is inconsistent even when the versionId matches", () => {
    const result = evaluatePublishConsistency({
        uploadResult: { versionId: "v1", etag: "\"abc\"" },
        head: consistentHead({ ContentLength: EXPECTED.expectedBytes + 1 }),
        ...EXPECTED
    });
    assert.equal(result.consistent, false);
    assert.equal(result.ownershipConfirmed, true);
});

test("a ciphertext-sha256 metadata mismatch is inconsistent", () => {
    const result = evaluatePublishConsistency({
        uploadResult: { versionId: "v1", etag: "\"abc\"" },
        head: consistentHead({ Metadata: { "ciphertext-sha256": "b".repeat(64), "key-id": EXPECTED.expectedKeyId } }),
        ...EXPECTED
    });
    assert.equal(result.consistent, false);
});

test("a key-id metadata mismatch is inconsistent", () => {
    const result = evaluatePublishConsistency({
        uploadResult: { versionId: "v1", etag: "\"abc\"" },
        head: consistentHead({ Metadata: { "ciphertext-sha256": EXPECTED.expectedCiphertextSha256, "key-id": "some-other-key" } }),
        ...EXPECTED
    });
    assert.equal(result.consistent, false);
});

test("ownership is not confirmed when the HeadObject versionId differs from the one this upload created (a newer version has since been published)", () => {
    const result = evaluatePublishConsistency({
        uploadResult: { versionId: "v1", etag: "\"abc\"" },
        head: consistentHead({ VersionId: "v2-published-by-someone-else" }),
        ...EXPECTED
    });
    assert.equal(result.ownershipConfirmed, false);
});

test("missing metadata entirely is inconsistent, not silently treated as matching", () => {
    const result = evaluatePublishConsistency({
        uploadResult: { versionId: "v1", etag: "\"abc\"" },
        head: consistentHead({ Metadata: undefined }),
        ...EXPECTED
    });
    assert.equal(result.consistent, false);
});
