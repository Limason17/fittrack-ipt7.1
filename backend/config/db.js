const mysql = require("mysql2");
require("dotenv").config();

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    charset: "utf8mb4"
});

db.connect((err) => {
    if (err) {
        console.error("Database connection failed:", err.message);
        return;
    }

    db.query("SET NAMES utf8mb4", (charsetErr) => {
        if (charsetErr) {
            console.error("Error setting charset:", charsetErr.message);
        } else {
            console.log("Connected to MySQL database");
        }
    });
});

module.exports = db;