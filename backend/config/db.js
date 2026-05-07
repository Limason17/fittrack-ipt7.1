const mysql = require("mysql2");
require("dotenv").config();

const db = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "root",
    database: process.env.DB_NAME || "fittrack",
    port: Number(process.env.DB_PORT) || 3306,
    charset: "utf8mb4",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

db.query("SELECT 1", (err) => {
    if (err) {
        console.error("Database connection failed:", err.message);
        return;
    }

    console.log("Connected to MySQL database");
});

module.exports = db;
