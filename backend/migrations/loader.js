const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { validateMigrationRegistry } = require("./planner");

const DEFAULT_MIGRATIONS_DIRECTORY = path.resolve(
    __dirname,
    "../../database/migrations"
);

function checksum(content) {
    const normalizedSource = Buffer.isBuffer(content)
        ? content.toString("utf8")
        : String(content);

    return crypto
        .createHash("sha256")
        .update(normalizedSource.replace(/\r\n?/g, "\n"), "utf8")
        .digest("hex");
}

function loadMigrations(directory = DEFAULT_MIGRATIONS_DIRECTORY) {
    const filenames = fs
        .readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /^\d{3,}_[a-z0-9_]+\.js$/.test(entry.name))
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));

    const migrations = filenames.map((filename) => {
        const absolutePath = path.join(directory, filename);
        const source = fs.readFileSync(absolutePath);
        delete require.cache[require.resolve(absolutePath)];
        const definition = require(absolutePath);
        const idFromFilename = path.basename(filename, ".js");

        if (definition.id !== idFromFilename) {
            const error = new Error(
                `Migration id ${definition.id || "<missing>"} does not match ${filename}.`
            );
            error.code = "INVALID_MIGRATION_REGISTRY";
            throw error;
        }

        return {
            id: definition.id,
            description: definition.description || definition.id,
            checksum: checksum(source),
            up: definition.up,
            filename,
            absolutePath
        };
    });

    return validateMigrationRegistry(migrations);
}

module.exports = {
    DEFAULT_MIGRATIONS_DIRECTORY,
    checksum,
    loadMigrations
};
