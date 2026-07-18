const test = require("node:test");
const assert = require("node:assert/strict");

const {
    completedInvitationOlderThan,
    createPublicId,
    isPublicId,
    isStudioSlug,
    normalizeStudioSlug
} = require("../../domain/studioDomain");

test("studio public ids are lowercase UUID v4 values", () => {
    const value = "123e4567-e89b-42d3-a456-426614174000";
    assert.equal(createPublicId(() => value.toUpperCase()), value);
    assert.equal(isPublicId(value), true);
    assert.equal(isPublicId("123e4567-e89b-12d3-a456-426614174000"), false);
    assert.throws(() => createPublicId(() => "not-a-uuid"), TypeError);
});

test("studio slugs are deterministic, normalized, and bounded", () => {
    assert.equal(normalizeStudioSlug("  Zürich Kraft & Cardio  "), "zurich-kraft-cardio");
    assert.equal(normalizeStudioSlug("A---B"), "a-b");
    assert.equal(isStudioSlug("zurich-kraft-cardio"), true);
    assert.equal(isStudioSlug("ab"), false);
    assert.equal(isStudioSlug("Uppercase"), false);
    assert.equal(isStudioSlug(`a${"b".repeat(80)}`), false);
});

test("completed invitation retention uses the appropriate completion timestamp", () => {
    const now = new Date("2026-07-18T12:00:00.000Z");
    assert.equal(completedInvitationOlderThan({
        status: "accepted",
        accepted_at: "2026-04-01T00:00:00.000Z"
    }, now), true);
    assert.equal(completedInvitationOlderThan({
        status: "revoked",
        revoked_at: "2026-07-01T00:00:00.000Z"
    }, now), false);
    assert.equal(completedInvitationOlderThan({
        status: "pending",
        expires_at: "2020-01-01T00:00:00.000Z"
    }, now), false);
});
