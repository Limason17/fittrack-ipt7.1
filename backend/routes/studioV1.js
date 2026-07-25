const express = require("express");

const db = require("../config/db");
const authenticateToken = require("../middleware/authMiddleware");
const {
    createStudioContextMiddleware,
    requireStudioPermission
} = require("../middleware/studioContext");
const { PERMISSIONS } = require("../domain/studioPolicy");
const { createInvitationRateLimiters } = require("../middleware/rateLimiter");
const { createStudioService } = require("../services/studioService");
const {
    validateCreateStudioPayload,
    validateInvitationPayload,
    validateMembershipPatchPayload,
    validatePagination,
    validatePublicId,
    validateStudioPatchPayload
} = require("../validation/studioValidation");

function createStudioV1Router({
    service = createStudioService({ database: db.promise() }),
    authenticate = authenticateToken,
    rateLimiters = createInvitationRateLimiters()
} = {}) {
    if (!service || typeof service !== "object") {
        throw new TypeError("Studio v1 router requires a studio service.");
    }
    if (typeof authenticate !== "function") {
        throw new TypeError("Studio v1 router requires authentication middleware.");
    }

    const router = express.Router();
    const context = createStudioContextMiddleware({ service });
    const permission = requireStudioPermission;

    router.post("/studios", authenticate, async (req, res) => {
        const input = validateCreateStudioPayload(req.body);
        const studio = await service.createStudio(req.user.id, input);
        res.status(201).json({ studio });
    });

    router.get("/studios", authenticate, async (req, res) => {
        const studios = await service.listStudios(req.user.id);
        res.json({ studios });
    });

    router.post("/invitations/:token/accept", authenticate, async (req, res) => {
        const result = await service.acceptInvitation(req.user.id, req.params.token);
        res.json(result);
    });

    router.get(
        "/studios/:studioId",
        authenticate,
        context,
        permission(PERMISSIONS.STUDIO_READ),
        async (req, res) => {
            res.json({ studio: service.getStudio(req.studioContext) });
        }
    );

    router.patch(
        "/studios/:studioId",
        authenticate,
        context,
        async (req, res) => {
            const input = validateStudioPatchPayload(req.body);
            const studio = await service.updateStudio(
                req.user.id,
                req.studioContext,
                input
            );
            res.json({ studio });
        }
    );

    router.get(
        "/studios/:studioId/memberships/me",
        authenticate,
        context,
        permission(PERMISSIONS.MEMBERSHIP_READ_SELF),
        async (req, res) => {
            const membership = await service.getOwnMembership(
                req.user.id,
                req.studioContext
            );
            res.json({ membership });
        }
    );

    router.get(
        "/studios/:studioId/memberships",
        authenticate,
        context,
        permission(PERMISSIONS.MEMBERSHIP_LIST),
        async (req, res) => {
            const result = await service.listMemberships(
                req.studioContext,
                validatePagination(req.query)
            );
            res.json(result);
        }
    );

    router.patch(
        "/studios/:studioId/memberships/:membershipId",
        authenticate,
        context,
        permission(PERMISSIONS.MEMBERSHIP_MANAGE),
        async (req, res) => {
            const membershipId = validatePublicId(req.params.membershipId, "membershipId");
            const input = validateMembershipPatchPayload(req.body);
            const membership = await service.updateMembership(
                req.user.id,
                req.studioContext,
                membershipId,
                input
            );
            res.json({ membership });
        }
    );

    router.post(
        "/studios/:studioId/invitations",
        authenticate,
        context,
        permission(PERMISSIONS.INVITATION_CREATE),
        async (req, res) => {
            const input = validateInvitationPayload(req.body);
            const result = await service.createInvitation(
                req.user.id,
                req.studioContext,
                input,
                { requestId: req.requestId }
            );
            res.status(201).json(result);
        }
    );

    router.get(
        "/studios/:studioId/invitations",
        authenticate,
        context,
        permission(PERMISSIONS.INVITATION_LIST),
        async (req, res) => {
            const result = await service.listInvitations(
                req.studioContext,
                validatePagination(req.query)
            );
            res.json(result);
        }
    );

    router.delete(
        "/studios/:studioId/invitations/:invitationId",
        authenticate,
        context,
        permission(PERMISSIONS.INVITATION_REVOKE),
        async (req, res) => {
            const invitationId = validatePublicId(req.params.invitationId, "invitationId");
            const invitation = await service.revokeInvitation(
                req.user.id,
                req.studioContext,
                invitationId
            );
            res.json({ invitation });
        }
    );

    router.post(
        "/studios/:studioId/invitations/:invitationId/resend",
        authenticate,
        rateLimiters.resend,
        context,
        permission(PERMISSIONS.INVITATION_RESEND),
        async (req, res) => {
            const invitationId = validatePublicId(req.params.invitationId, "invitationId");
            const result = await service.resendInvitation(
                req.user.id,
                req.studioContext,
                invitationId,
                { requestId: req.requestId }
            );
            res.json(result);
        }
    );

    router.get(
        "/studios/:studioId/audit-events",
        authenticate,
        context,
        permission(PERMISSIONS.AUDIT_READ),
        async (req, res) => {
            const result = await service.listAuditEvents(
                req.studioContext,
                validatePagination(req.query)
            );
            res.json(result);
        }
    );

    return router;
}

// No eager default-instance export here: the application's single,
// explicit composition root (startup/app.js#defaultRouters) is what
// decides which service instance the real server uses. Exporting only the
// factory keeps this file from silently constructing (and discarding) its
// own extra, independent studio service - including its own extra,
// independent invitation delivery/SMTP provider - purely as a require()
// side effect.
module.exports = { createStudioV1Router };
