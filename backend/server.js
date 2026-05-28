const express = require("express");
const cors = require("cors");
require("dotenv").config();

require("./config/db");
const ensureTrainingSchema = require("./utils/ensureTrainingSchema");
const usersRoutes = require("./routes/users");
const exercisesRoutes = require("./routes/exercises");
const workoutsRoutes = require("./routes/workouts");
const progressRoutes = require("./routes/progress");

const app = express();

function allowedOrigins() {
    return (process.env.CORS_ORIGIN || "")
        .split(",")
        .map((origin) => origin.trim())
        .map((origin) => origin.toLowerCase())
        .filter(Boolean);
}

const configuredOrigins = allowedOrigins();

if (process.env.NODE_ENV === "production" && configuredOrigins.length === 0) {
    throw new Error("CORS_ORIGIN must be set in production.");
}

app.disable("x-powered-by");
app.use(cors({
    origin(origin, callback) {
        const requestOrigin = origin?.toLowerCase();

        if (configuredOrigins.length === 0 || !requestOrigin || configuredOrigins.includes(requestOrigin)) {
            callback(null, true);
            return;
        }

        const error = new Error("Not allowed by CORS");
        error.status = 403;
        callback(error);
    }
}));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => {
    res.json({ message: "API is running" });
});

app.use("/api/users", usersRoutes);
app.use("/api/exercises", exercisesRoutes);
app.use("/api/workouts", workoutsRoutes);
app.use("/api/progress", progressRoutes);

app.use((req, res) => {
    res.status(404).json({ message: "Route not found" });
});

app.use((err, req, res, next) => {
    console.error("Unhandled API error:", err.message);
    res.status(err.status || 500).json({ message: err.status ? err.message : "Server error" });
});

const PORT = process.env.PORT || 3001;

ensureTrainingSchema()
    .catch((error) => {
        console.error("Training schema migration failed:", error.message);
    })
    .finally(() => {
        app.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });
    });
