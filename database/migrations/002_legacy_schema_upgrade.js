function driftError(message) {
    const error = new Error(message);
    error.code = "LEGACY_SCHEMA_DRIFT";
    return error;
}

function normalizedType(value) {
    return String(value || "").toLowerCase().replace(/\s+/g, "");
}

async function ensureColumn({
    connection,
    helpers,
    table,
    column,
    definition,
    expectedType,
    nullable,
    allowModify = false
}) {
    const info = await helpers.columnInfo(table, column);

    if (!info) {
        await connection.query(
            `ALTER TABLE ${helpers.escapeId(table)} ADD COLUMN ${helpers.escapeId(column)} ${definition}`
        );
        return;
    }

    const typeMatches = normalizedType(info.column_type) === normalizedType(expectedType);
    const nullabilityMatches = info.is_nullable === (nullable ? "YES" : "NO");

    if (typeMatches && nullabilityMatches) {
        return;
    }

    if (!allowModify) {
        throw driftError(
            `Unexpected definition for ${table}.${column}: ${info.column_type} ${info.is_nullable}`
        );
    }

    await connection.query(
        `ALTER TABLE ${helpers.escapeId(table)} MODIFY COLUMN ${helpers.escapeId(column)} ${definition}`
    );
}

async function ensureIndex({ connection, helpers, table, name, columns, unique = false }) {
    const existing = await helpers.indexInfo(table, name);
    if (existing.length > 0) {
        const existingColumns = existing.map((item) => item.column_name);
        const existingUnique = Number(existing[0].non_unique) === 0;
        if (
            existingUnique !== unique ||
            existingColumns.length !== columns.length ||
            existingColumns.some((column, index) => column !== columns[index])
        ) {
            throw driftError(`Unexpected definition for index ${table}.${name}.`);
        }
        return;
    }

    const keyword = unique ? "UNIQUE INDEX" : "INDEX";
    await connection.query(
        `ALTER TABLE ${helpers.escapeId(table)} ADD ${keyword} ${helpers.escapeId(name)} (${columns
            .map(helpers.escapeId)
            .join(", ")})`
    );
}

async function ensureForeignKey({
    connection,
    helpers,
    table,
    name,
    columns,
    referencedTable,
    referencedColumns,
    deleteRule = "NO ACTION"
}) {
    const existing = await helpers.foreignKeyInfo(table, name);
    if (existing.length > 0) {
        const sameColumns = existing.map((item) => item.column_name).join(",") === columns.join(",");
        const sameReferencedColumns =
            existing.map((item) => item.referenced_column_name).join(",") ===
            referencedColumns.join(",");
        const actualDeleteRule = existing[0].delete_rule;
        const acceptedDeleteRules =
            deleteRule === "NO ACTION" ? new Set(["NO ACTION", "RESTRICT"]) : new Set([deleteRule]);

        if (
            !sameColumns ||
            !sameReferencedColumns ||
            existing[0].referenced_table_name !== referencedTable ||
            !acceptedDeleteRules.has(actualDeleteRule)
        ) {
            throw driftError(`Unexpected definition for foreign key ${table}.${name}.`);
        }
        return;
    }

    await connection.query(`
        ALTER TABLE ${helpers.escapeId(table)}
        ADD CONSTRAINT ${helpers.escapeId(name)}
        FOREIGN KEY (${columns.map(helpers.escapeId).join(", ")})
        REFERENCES ${helpers.escapeId(referencedTable)} (${referencedColumns
            .map(helpers.escapeId)
            .join(", ")})
        ON DELETE ${deleteRule}
    `);
}

module.exports = {
    id: "002_legacy_schema_upgrade",
    description: "Upgrade supported unversioned FitTrack schemas without resetting data",
    async up({ connection, helpers }) {
        const requiredTables = [
            "users",
            "exercises",
            "workouts",
            "workout_exercises",
            "progress_entries"
        ];
        for (const table of requiredTables) {
            if (!(await helpers.tableExists(table))) {
                throw driftError(`Required table ${table} is missing after baseline migration.`);
            }
        }

        const columns = [
            {
                table: "users",
                column: "language_preference",
                definition: "ENUM('de', 'en') NOT NULL DEFAULT 'de'",
                expectedType: "enum('de','en')",
                nullable: false
            },
            {
                table: "users",
                column: "weight_unit",
                definition: "ENUM('kg', 'lb') NOT NULL DEFAULT 'kg'",
                expectedType: "enum('kg','lb')",
                nullable: false
            },
            {
                table: "users",
                column: "distance_unit",
                definition: "ENUM('km', 'mi') NOT NULL DEFAULT 'km'",
                expectedType: "enum('km','mi')",
                nullable: false
            },
            {
                table: "workout_exercises",
                column: "sets",
                definition: "INT NULL",
                expectedType: "int",
                nullable: true,
                allowModify: true
            },
            {
                table: "workout_exercises",
                column: "reps",
                definition: "INT NULL",
                expectedType: "int",
                nullable: true,
                allowModify: true
            },
            {
                table: "workout_exercises",
                column: "weight",
                definition: "DECIMAL(6,2) NULL",
                expectedType: "decimal(6,2)",
                nullable: true,
                allowModify: true
            },
            {
                table: "workout_exercises",
                column: "duration_minutes",
                definition: "INT NULL",
                expectedType: "int",
                nullable: true
            },
            {
                table: "workout_exercises",
                column: "distance_km",
                definition: "DECIMAL(7,2) NULL",
                expectedType: "decimal(7,2)",
                nullable: true
            },
            {
                table: "workout_exercises",
                column: "intensity_level",
                definition: "INT NULL",
                expectedType: "int",
                nullable: true
            },
            {
                table: "progress_entries",
                column: "workout_id",
                definition: "INT NULL",
                expectedType: "int",
                nullable: true
            },
            {
                table: "progress_entries",
                column: "sets",
                definition: "INT NULL",
                expectedType: "int",
                nullable: true,
                allowModify: true
            },
            {
                table: "progress_entries",
                column: "reps",
                definition: "INT NULL",
                expectedType: "int",
                nullable: true,
                allowModify: true
            },
            {
                table: "progress_entries",
                column: "weight",
                definition: "DECIMAL(6,2) NULL",
                expectedType: "decimal(6,2)",
                nullable: true,
                allowModify: true
            },
            {
                table: "progress_entries",
                column: "duration_minutes",
                definition: "INT NULL",
                expectedType: "int",
                nullable: true
            },
            {
                table: "progress_entries",
                column: "distance_km",
                definition: "DECIMAL(7,2) NULL",
                expectedType: "decimal(7,2)",
                nullable: true
            },
            {
                table: "progress_entries",
                column: "intensity_level",
                definition: "INT NULL",
                expectedType: "int",
                nullable: true
            }
        ];

        for (const column of columns) {
            await ensureColumn({ connection, helpers, ...column });
        }

        await ensureIndex({
            connection,
            helpers,
            table: "exercises",
            name: "idx_exercises_user",
            columns: ["user_id"]
        });
        await ensureIndex({
            connection,
            helpers,
            table: "workouts",
            name: "idx_workouts_user_date",
            columns: ["user_id", "workout_date"]
        });
        await ensureIndex({
            connection,
            helpers,
            table: "progress_entries",
            name: "idx_progress_user_date",
            columns: ["user_id", "entry_date"]
        });

        const foreignKeys = [
            {
                table: "exercises",
                name: "fk_exercises_user",
                columns: ["user_id"],
                referencedTable: "users",
                referencedColumns: ["id"],
                deleteRule: "SET NULL"
            },
            {
                table: "workouts",
                name: "fk_workouts_user",
                columns: ["user_id"],
                referencedTable: "users",
                referencedColumns: ["id"],
                deleteRule: "CASCADE"
            },
            {
                table: "workout_exercises",
                name: "fk_workout_exercises_workout",
                columns: ["workout_id"],
                referencedTable: "workouts",
                referencedColumns: ["id"],
                deleteRule: "CASCADE"
            },
            {
                table: "workout_exercises",
                name: "fk_workout_exercises_exercise",
                columns: ["exercise_id"],
                referencedTable: "exercises",
                referencedColumns: ["id"]
            },
            {
                table: "progress_entries",
                name: "fk_progress_user",
                columns: ["user_id"],
                referencedTable: "users",
                referencedColumns: ["id"],
                deleteRule: "CASCADE"
            },
            {
                table: "progress_entries",
                name: "fk_progress_workout",
                columns: ["workout_id"],
                referencedTable: "workouts",
                referencedColumns: ["id"],
                deleteRule: "CASCADE"
            },
            {
                table: "progress_entries",
                name: "fk_progress_exercise",
                columns: ["exercise_id"],
                referencedTable: "exercises",
                referencedColumns: ["id"]
            }
        ];

        for (const foreignKey of foreignKeys) {
            await ensureForeignKey({ connection, helpers, ...foreignKey });
        }
    }
};
