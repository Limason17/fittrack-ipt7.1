const fsPromises = require("node:fs/promises");
const path = require("node:path");

function receiptStoreError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function receiptFilePath(directory, receiptId) {
    return path.join(directory, `${receiptId}.json`);
}

async function ensureReceiptDirectory(directory) {
    await fsPromises.mkdir(directory, { recursive: true, mode: 0o700 });
}

// Atomic publication: write to a `.partial` file via an exclusive create
// (`wx` - fails if a stale partial already exists, rather than silently
// overwriting evidence of a previous incomplete write), fsync it, then
// publish via `link()` rather than `rename()`. `link()` is atomic at the
// OS level and fails with EEXIST if the destination already exists -
// `rename()` would silently clobber it instead. A receipt, once published,
// must never be overwritten (Section 16) - practically unreachable given
// receiptId is a fresh random UUID per call, but this makes that guarantee
// structural rather than merely probabilistic. `mode:` is a POSIX-only
// hint (Windows ignores it, same accepted posture as the encrypted backup
// scripts - see encryptedBackupCreate.js's own comment); atomicity itself
// comes from `link()`/`unlink()`, which behave the same on NTFS.
async function publishReceipt(directory, receipt) {
    if (!receipt || typeof receipt.receiptId !== "string" || !receipt.receiptId) {
        throw new TypeError("publishReceipt requires a receipt with a receiptId.");
    }

    await ensureReceiptDirectory(directory);
    const finalPath = receiptFilePath(directory, receipt.receiptId);
    const partialPath = `${finalPath}.partial`;
    const json = `${JSON.stringify(receipt, null, 2)}\n`;

    const handle = await fsPromises.open(partialPath, "wx", 0o600);
    try {
        await handle.writeFile(json, "utf8");
        await handle.sync();
    } finally {
        await handle.close();
    }

    try {
        await fsPromises.link(partialPath, finalPath);
    } catch (error) {
        if (error.code === "EEXIST") {
            await fsPromises.rm(partialPath, { force: true });
            throw receiptStoreError(
                "DELETION_RECEIPT_ALREADY_EXISTS",
                `A receipt already exists at ${finalPath}.`
            );
        }
        throw error;
    }
    await fsPromises.unlink(partialPath);

    return finalPath;
}

async function readReceiptFile(filePath) {
    let raw;
    try {
        raw = await fsPromises.readFile(filePath, "utf8");
    } catch (error) {
        if (error.code === "ENOENT") {
            throw receiptStoreError("DELETION_RECEIPT_NOT_FOUND", `No receipt file exists at ${filePath}.`);
        }
        throw error;
    }
    try {
        return JSON.parse(raw);
    } catch {
        throw receiptStoreError("DELETION_RECEIPT_MALFORMED", `Receipt file ${filePath} is not valid JSON.`);
    }
}

async function listReceiptFiles(directory) {
    let entries;
    try {
        entries = await fsPromises.readdir(directory, { withFileTypes: true });
    } catch (error) {
        if (error.code === "ENOENT") {
            return [];
        }
        throw error;
    }
    return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => path.join(directory, entry.name))
        .sort();
}

module.exports = {
    ensureReceiptDirectory,
    listReceiptFiles,
    publishReceipt,
    readReceiptFile,
    receiptFilePath,
    receiptStoreError
};
