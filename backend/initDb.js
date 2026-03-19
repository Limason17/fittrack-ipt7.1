const mysql = require("mysql2");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    multipleStatements: true
});

const schemaPath = path.join(__dirname, "../database/schema.sql");
const seedPath = path.join(__dirname, "../database/seed.sql");

const schemaSql = fs.readFileSync(schemaPath, "utf8");
const seedSql = fs.readFileSync(seedPath, "utf8");

connection.query(schemaSql, (err) => {
    if (err) {
        console.error("Error while creating database:", err.message);
        connection.end();
        return;
    }

    console.log("Database and tables created successfully.");

    connection.query(seedSql, (err) => {
        if (err) {
            console.error("Error while inserting test data:", err.message);
        } else {
            console.log("Test data inserted successfully.");
        }
        connection.end();
    });
});