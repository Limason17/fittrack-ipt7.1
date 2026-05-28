const isProduction = process.env.NODE_ENV === "production";
const JWT_SECRET = process.env.JWT_SECRET || (isProduction ? null : "fittrack-development-secret");

if (!JWT_SECRET) {
    throw new Error("JWT_SECRET must be set in production.");
}

module.exports = {
    JWT_SECRET
};
