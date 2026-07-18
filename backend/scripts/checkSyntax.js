const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const backendRoot = path.resolve(__dirname, "..");
const migrationRoot = path.resolve(backendRoot, "..", "database", "migrations");
const ignoredDirectories = new Set(["node_modules", "dist", "coverage"]);

function javascriptFiles(root) {
    const files = [];
    function visit(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
            const fullPath = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(fullPath);
            else if (entry.isFile() && entry.name.endsWith(".js")) files.push(fullPath);
        }
    }
    visit(root);
    return files;
}

const files = [...javascriptFiles(backendRoot), ...javascriptFiles(migrationRoot)].sort();
for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], {
        encoding: "utf8",
        windowsHide: true
    });
    if (result.status !== 0) {
        process.stderr.write(result.stderr || result.stdout || `Syntax check failed: ${file}\n`);
        process.exit(result.status || 1);
    }
}

process.stdout.write(`Syntax check passed for ${files.length} JavaScript files.\n`);

