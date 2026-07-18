const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createStudioContextMiddleware,
    requireStudioPermission
} = require("../../middleware/studioContext");
const { PERMISSIONS } = require("../../domain/studioPolicy");
const { StudioNotFoundError } = require("../../errors/StudioErrors");

const STUDIO_ID = "123e4567-e89b-42d3-a456-426614174000";

test("malformed and foreign studio identifiers use the same not-found contract", async () => {
    let serviceCalls = 0;
    const middleware = createStudioContextMiddleware({
        service: {
            async loadStudioContext(userId, publicId) {
                serviceCalls += 1;
                assert.equal(userId, 7);
                assert.equal(publicId, STUDIO_ID);
                throw new StudioNotFoundError();
            }
        }
    });
    async function outcome(studioId) {
        let result;
        await middleware({ params: { studioId }, user: { id: 7 } }, {}, (error) => {
            result = error || null;
        });
        return result;
    }
    const malformed = await outcome("guessed-id");
    const foreign = await outcome(STUDIO_ID);
    assert.equal(malformed.code, "STUDIO_NOT_FOUND");
    assert.equal(foreign.code, "STUDIO_NOT_FOUND");
    assert.equal(malformed.status, foreign.status);
    assert.equal(malformed.message, foreign.message);
    assert.equal(serviceCalls, 1, "malformed ids must not reach the database service");
});

test("permission middleware is default deny for inactive or insufficient roles", () => {
    const requireAudit = requireStudioPermission(PERMISSIONS.AUDIT_READ);
    for (const membership of [
        { role: "member", status: "active" },
        { role: "owner", status: "suspended" },
        { role: "owner", status: "left" },
        { role: "unexpected", status: "active" }
    ]) {
        let outcome;
        requireAudit({ studioContext: { membership } }, {}, (error) => { outcome = error || null; });
        assert.equal(outcome.code, "INSUFFICIENT_STUDIO_ROLE");
    }
    let ownerOutcome = "not-called";
    requireAudit({
        studioContext: { membership: { role: "owner", status: "active" } }
    }, {}, (error) => { ownerOutcome = error || null; });
    assert.equal(ownerOutcome, null);
});
