const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
    allowlistedAuditDetails,
    buildAuditEvent,
    sanitizeAuditDetails
} = require("../../audit/studioAudit");
const { createInvitationDelivery } = require("../../delivery/invitationDelivery");
const { createInvitationOutbox } = require("../../outbox/invitationOutbox");
const {
    createInvitationToken,
    hashInvitationToken,
    invitationTokenHashesEqual
} = require("../../security/invitationTokens");
const {
    createStudioService,
    invitationStateError,
    membershipChangeAuditEvents,
    paginationResult,
    publicInvitation,
    publicMembership,
    publicStudio,
    updateStatement
} = require("../../services/studioService");

const STUDIO_ID = "123e4567-e89b-42d3-a456-426614174000";
const MEMBERSHIP_ID = "223e4567-e89b-42d3-a456-426614174000";

test("invitation tokens use exactly 32 random bytes and SHA-256 binary hashes", () => {
    const bytes = Buffer.alloc(32, 7);
    const generated = createInvitationToken((size) => {
        assert.equal(size, 32);
        return bytes;
    });
    assert.match(generated.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(generated.tokenHash.length, 32);
    assert.deepEqual(generated.tokenHash, crypto.createHash("sha256").update(generated.token).digest());
    assert.equal(invitationTokenHashesEqual(generated.tokenHash, hashInvitationToken(generated.token)), true);
    assert.throws(() => hashInvitationToken("short"), (error) => error.code === "INVALID_INVITATION_TOKEN");
});

test("audit events accept only bounded event-specific details", () => {
    const event = buildAuditEvent({
        studioId: 1,
        actorUserId: 2,
        eventType: "invitation.accepted",
        targetType: "invitation",
        targetPublicId: STUDIO_ID,
        publicId: MEMBERSHIP_ID,
        details: { membershipId: MEMBERSHIP_ID, role: "member" }
    });
    assert.deepEqual(JSON.parse(event.detailsJson), {
        membershipId: MEMBERSHIP_ID,
        role: "member"
    });
    assert.throws(() => allowlistedAuditDetails("invitation.created", {
        role: "member",
        email: "private@example.test"
    }), /not allowlisted/);
    assert.throws(() => allowlistedAuditDetails("studio.updated", {
        fields: ["request_body"]
    }), /invalid/);
    assert.throws(() => buildAuditEvent({
        studioId: 1,
        actorUserId: 2,
        eventType: "unknown.event",
        targetType: "studio",
        targetPublicId: STUDIO_ID,
        details: {}
    }), /safe detail contract/);
    assert.doesNotMatch(event.detailsJson, /email|token|password/i);
});

test("membership changes emit the exact granular audit event types the contract requires", () => {
    const target = { role: "trainer", status: "active" };

    const roleOnly = membershipChangeAuditEvents(target, { role: "member" });
    assert.deepEqual(roleOnly, [
        {
            eventType: "membership.role_changed",
            details: {
                before: { role: "trainer", status: "active" },
                after: { role: "member", status: "active" }
            }
        }
    ]);

    const suspend = membershipChangeAuditEvents(target, { status: "suspended" });
    assert.equal(suspend[0].eventType, "membership.suspended");

    const reactivate = membershipChangeAuditEvents(
        { role: "member", status: "suspended" },
        { status: "active" }
    );
    assert.equal(reactivate[0].eventType, "membership.reactivated");

    const leave = membershipChangeAuditEvents(target, { status: "left" });
    assert.equal(leave[0].eventType, "membership.left");

    const both = membershipChangeAuditEvents(target, { role: "admin", status: "suspended" });
    assert.deepEqual(both.map((event) => event.eventType), [
        "membership.role_changed",
        "membership.suspended"
    ]);

    for (const eventType of [
        "membership.role_changed",
        "membership.suspended",
        "membership.reactivated",
        "membership.left"
    ]) {
        assert.doesNotThrow(() => allowlistedAuditDetails(eventType, {
            before: { role: "trainer", status: "active" },
            after: { role: "member", status: "suspended" }
        }));
    }
    assert.throws(
        () => allowlistedAuditDetails("membership.updated", { before: {}, after: {} }),
        /safe detail contract/
    );
});

test("generic audit sanitizer redacts token material, secrets, and buffers", () => {
    const token = Buffer.alloc(32, 5).toString("base64url");
    const safe = sanitizeAuditDetails({
        token,
        nested: { authorization: "Bearer secret", value: token },
        raw: Buffer.from("secret")
    });
    assert.doesNotMatch(JSON.stringify(safe), new RegExp(token));
    assert.match(JSON.stringify(safe), /REDACTED/);
});

test("production invitation delivery requires an explicitly configured provider", async () => {
    const delivery = createInvitationDelivery({
        env: {
            NODE_ENV: "production",
            INVITATION_ACCEPT_BASE_URL: "https://app.example.test"
        }
    });
    assert.throws(
        () => delivery.assertAvailable(),
        (error) => error.code === "INVITATION_DELIVERY_UNAVAILABLE"
    );
    await assert.rejects(
        delivery.send({}),
        (error) => error.code === "INVITATION_DELIVERY_UNAVAILABLE"
    );

    const delivered = [];
    const configured = createInvitationDelivery({
        env: {
            NODE_ENV: "production",
            INVITATION_ACCEPT_BASE_URL: "https://app.example.test"
        },
        provider: {
            async sendInvitation(message) {
                delivered.push(message);
            }
        }
    });
    const token = Buffer.alloc(32, 9).toString("base64url");
    assert.doesNotThrow(() => configured.assertAvailable());
    assert.deepEqual(await configured.send({
        token,
        email: "member@example.test",
        studioName: "Studio",
        role: "member",
        expiresAt: new Date("2026-08-01T00:00:00Z")
    }), { delivered: true });
    assert.equal(delivered[0].acceptanceUrl, `https://app.example.test/invitations/${token}`);

    for (const invalidBaseUrl of [
        undefined,
        "http://app.example.test",
        "https://user:password@app.example.test",
        "https://app.example.test?tenant=unsafe"
    ]) {
        const invalid = createInvitationDelivery({
            env: {
                NODE_ENV: "production",
                ...(invalidBaseUrl ? { INVITATION_ACCEPT_BASE_URL: invalidBaseUrl } : {})
            },
            provider: { async sendInvitation() {} }
        });
        assert.throws(
            () => invalid.assertAvailable(),
            (error) => error.code === "INVITATION_DELIVERY_UNAVAILABLE"
        );
    }
});

test("service update SQL uses an explicit column allowlist", () => {
    assert.deepEqual(
        updateStatement({ default_locale: "de" }, { default_locale: "default_locale" }),
        {
            fields: ["default_locale"],
            assignments: "default_locale = ?",
            values: ["de"]
        }
    );
    assert.throws(
        () => updateStatement({ "name = 'owned' --": "x" }, { name: "name" }),
        (error) => error.code === "INVALID_SERVICE_INPUT"
    );
});

test("connection is released if transaction start fails and IDs are generated before checkout", async () => {
    let checkouts = 0;
    let releases = 0;
    const database = {
        async getConnection() {
            checkouts += 1;
            return {
                async beginTransaction() {
                    throw new Error("begin failed");
                },
                release() {
                    releases += 1;
                }
            };
        }
    };
    const service = createStudioService({ database });
    await assert.rejects(
        service.createStudio(1, {}),
        /begin failed/
    );
    assert.equal(checkouts, 1);
    assert.equal(releases, 1);

    const generatorFailure = createStudioService({
        database,
        generatePublicId() {
            throw new Error("random source failed");
        }
    });
    await assert.rejects(generatorFailure.createStudio(1, {}), /random source failed/);
    assert.equal(checkouts, 1);
    assert.equal(releases, 1);
});

test("studio creation builds its exact response before commit without a post-commit query", async () => {
    const studioId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();
    const createdAt = new Date("2026-07-18T10:00:00.123Z");
    let generated = 0;
    let committed = false;
    let released = false;
    let queryCount = 0;
    const connection = {
        async beginTransaction() {},
        async query() {
            assert.equal(committed, false, "response query must run before commit");
            queryCount += 1;
            if (queryCount === 1) return [{ insertId: 7 }];
            if (queryCount === 2 || queryCount === 3) return [{}];
            return [[{
                studio_internal_id: 7,
                studio_public_id: studioId,
                name: "Snapshot Studio",
                slug: "snapshot-studio",
                studio_status: "active",
                default_locale: "de",
                default_timezone: "Europe/Zurich",
                default_weight_unit: "kg",
                studio_created_at: createdAt,
                studio_updated_at: createdAt,
                membership_internal_id: 8,
                membership_public_id: membershipId,
                user_id: 42,
                membership_role: "owner",
                membership_status: "active",
                joined_at: createdAt,
                membership_created_at: createdAt,
                membership_updated_at: createdAt
            }]];
        },
        async commit() {
            committed = true;
        },
        async rollback() {},
        release() {
            released = true;
        }
    };
    const service = createStudioService({
        database: { async getConnection() { return connection; } },
        generatePublicId() {
            generated += 1;
            return generated === 1 ? studioId : membershipId;
        }
    });
    const studio = await service.createStudio(42, {
        name: "Snapshot Studio",
        slug: "snapshot-studio",
        default_locale: "de",
        default_timezone: "Europe/Zurich",
        default_weight_unit: "kg"
    });
    assert.equal(queryCount, 4);
    assert.equal(committed, true);
    assert.equal(released, true);
    assert.equal(studio.id, studioId);
    assert.equal(studio.membership.id, membershipId);
    assert.equal(studio.updatedAt, createdAt);
    assert.equal(studio.membership.updatedAt, createdAt);
});

test("development outbox returns the acceptance URL only in the delivery result", async () => {
    const token = Buffer.alloc(32, 3).toString("base64url");
    const outbox = createInvitationOutbox({
        delivery: createInvitationDelivery({
            env: {
                NODE_ENV: "test",
                INVITATION_ACCEPT_BASE_URL: "http://127.0.0.1:5173/app"
            }
        })
    });
    assert.doesNotThrow(() => outbox.assertAvailable());
    const result = await outbox.publish({ token });
    assert.equal(result.delivered, false);
    assert.equal(result.acceptUrl, `http://127.0.0.1:5173/app/invitations/${token}`);
    assert.equal(Object.hasOwn(outbox, "token"), false);
});

test("public projections are camelCase and privacy preserving", () => {
    assert.deepEqual(publicStudio({
        id: STUDIO_ID,
        name: "Studio",
        slug: "studio",
        status: "active",
        default_locale: "de",
        default_timezone: "Europe/Zurich",
        default_weight_unit: "kg",
        created_at: "created",
        updated_at: "updated"
    }), {
        id: STUDIO_ID,
        name: "Studio",
        slug: "studio",
        status: "active",
        defaultLocale: "de",
        defaultTimezone: "Europe/Zurich",
        defaultWeightUnit: "kg",
        createdAt: "created",
        updatedAt: "updated"
    });
    const former = publicMembership({
        id: MEMBERSHIP_ID,
        role: "member",
        status: "left",
        user: { username: "Former", email: "former@example.test" }
    });
    assert.deepEqual(former.user, { displayName: "Former member" });
    assert.doesNotMatch(JSON.stringify(former), /former@example\.test/);
    const completed = publicInvitation({
        public_id: STUDIO_ID,
        email_normalized: "private@example.test",
        role: "member",
        status: "accepted",
        expires_at: new Date("2026-01-01"),
        accepted_at: new Date("2025-12-01")
    });
    assert.equal(Object.hasOwn(completed, "email"), false);
    assert.equal(completed.acceptedAt instanceof Date, true);
    assert.deepEqual(paginationResult(41, { page: 2, limit: 20 }), {
        page: 2,
        limit: 20,
        total: 41,
        totalPages: 3
    });
    assert.equal(invitationStateError("accepted").code, "INVITATION_ALREADY_USED");

    const trainerProjection = publicMembership({
        id: MEMBERSHIP_ID,
        role: "member",
        status: "active",
        user: { displayName: "Member One" }
    });
    assert.deepEqual(trainerProjection.user, { displayName: "Member One" });
    assert.equal(Object.hasOwn(trainerProjection.user, "email"), false);
});
