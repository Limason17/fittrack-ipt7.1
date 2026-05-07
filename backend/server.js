const express = require("express");
const cors = require("cors");
require("dotenv").config();

require("./config/db");
const usersRoutes = require("./routes/users");
const exercisesRoutes = require("./routes/exercises");
const workoutsRoutes = require("./routes/workouts");
const progressRoutes = require("./routes/progress");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
    res.json({ message: "API is running" });
});

app.use("/api/users", usersRoutes);
app.use("/api/exercises", exercisesRoutes);
app.use("/api/workouts", workoutsRoutes);
app.use("/api/progress", progressRoutes);

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
