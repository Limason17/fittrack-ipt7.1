require("dotenv").config();

const db = require("../config/db");

db.query("SHOW TABLES", (error, rows) => {
    if (error) {
        console.error("DB check failed:", error.message);
        process.exit(1);
        return;
    }

    console.log("DB check successful:");
    console.log(rows);
    process.exit(0);
});
