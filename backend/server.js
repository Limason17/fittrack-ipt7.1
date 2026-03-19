const express = require("express");
const cors = require("cors");
require("dotenv").config();

const db = require("./config/db");
const usersRoutes = require("./routes/users");

const app = express();

app.use(cors());
app.use(express.json());

// Test route
app.get("/api/health", (req, res) => {
    res.json({ message: "API is running" });
});

app.use("/api/users", usersRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});