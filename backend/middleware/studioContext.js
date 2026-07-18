const { isPublicId } = require("../domain/studioDomain");
const { hasStudioPermission } = require("../domain/studioPolicy");
const {
    InsufficientStudioRoleError,
    StudioNotFoundError
} = require("../errors/StudioErrors");

function createStudioContextMiddleware({ service } = {}) {
    if (!service || typeof service.loadStudioContext !== "function") {
        throw new TypeError("Studio context middleware requires a studio service.");
    }

    return async function studioContextMiddleware(req, res, next) {
        const studioPublicId = req.params?.studioId;
        if (!isPublicId(studioPublicId)) {
            next(new StudioNotFoundError());
            return;
        }

        try {
            req.studioContext = await service.loadStudioContext(
                req.user.id,
                studioPublicId
            );
            next();
        } catch (error) {
            next(error);
        }
    };
}

function requireStudioPermission(permission) {
    if (typeof permission !== "string" || !permission) {
        throw new TypeError("A studio permission is required.");
    }

    return function studioPermissionMiddleware(req, res, next) {
        if (!hasStudioPermission(req.studioContext?.membership, permission)) {
            next(new InsufficientStudioRoleError());
            return;
        }
        next();
    };
}

module.exports = {
    createStudioContextMiddleware,
    requireStudioPermission
};
