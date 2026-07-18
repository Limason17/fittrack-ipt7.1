const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { afterEach, test } = require("node:test");

const { createApp } = require("../startup/app");
const { bootstrap } = require("../startup/bootstrap");
const { createReadinessProbe } = require("../startup/readiness");

const openServers = new Set();

afterEach(async () => {
    await Promise.all(
        [...openServers].map(
            (server) =>
                new Promise((resolve) => {
                    server.close(resolve);
                })
        )
    );
    openServers.clear();
});

function silentLogger() {
    return {
        info() {},
        warn() {},
        error() {}
    };
}

function runNode(args, options) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, {
            ...options,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true
        });
        let stdout = "";
        let stderr = "";
        let settled = false;

        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });

        const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill();
            reject(new Error("Node child process did not exit within 15 seconds"));
        }, 15000);

        child.once("error", (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            reject(error);
        });
        child.once("close", (code, signal) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve({ code, signal, stdout, stderr });
        });
    });
}

test("Server-Modulimport startet weder Listener noch DB-/Migration-I/O", async () => {
    const backendRoot = path.resolve(__dirname, "..");
    const result = await runNode(["-e", "require('./server.js')"], {
        cwd: backendRoot
    });

    assert.equal(result.code, 0, result.stderr || result.signal);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
});

function createBootstrapHarness(overrides = {}) {
    const calls = [];
    const database = {
        async verifyConnection() {
            calls.push("ping");
        },
        async close() {
            calls.push("close");
        },
        ...overrides.database
    };
    const migrationRunner = {
        async migrate() {
            calls.push("migrate");
            return { applied: [] };
        },
        async status() {
            calls.push("status");
            return { pending: [], dirty: [], drift: [], unknown: [] };
        },
        ...overrides.migrationRunner
    };
    const readiness = {
        markReady() {
            calls.push("ready");
        },
        markFailed() {
            calls.push("failed");
        },
        markShuttingDown() {
            calls.push("shutting_down");
        }
    };

    return {
        calls,
        dependencies: {
            database,
            migrationRunner,
            readiness,
            logger: silentLogger(),
            createApplication() {
                calls.push("create_app");
                return { name: "app" };
            },
            async listen() {
                calls.push("listen");
                return { name: "server" };
            }
        }
    };
}

test("FT-03: bei unerreichbarer DB wird niemals gelauscht", async () => {
    const harness = createBootstrapHarness({
        database: {
            async verifyConnection() {
                harness.calls.push("ping");
                const error = new Error("connect ECONNREFUSED secret-host");
                error.code = "ECONNREFUSED";
                throw error;
            }
        }
    });

    await assert.rejects(
        bootstrap(harness.dependencies),
        (error) => error.code === "DATABASE_UNAVAILABLE"
    );
    assert.equal(harness.calls.includes("listen"), false);
    assert.deepEqual(harness.calls, ["ping", "failed", "close"]);
});

test("FT-03: bei fehlgeschlagener Migration wird niemals gelauscht", async () => {
    const harness = createBootstrapHarness({
        migrationRunner: {
            async migrate() {
                harness.calls.push("migrate");
                const error = new Error("DDL failed");
                error.code = "MIGRATION_FAILED";
                throw error;
            }
        }
    });

    await assert.rejects(
        bootstrap(harness.dependencies),
        (error) => error.code === "MIGRATION_FAILED"
    );
    assert.equal(harness.calls.includes("listen"), false);
    assert.deepEqual(harness.calls, ["ping", "migrate", "failed", "close"]);
});

test("FT-03: bei weiterhin ausstehenden Migrationen wird niemals gelauscht", async () => {
    const harness = createBootstrapHarness({
        migrationRunner: {
            async migrate() {
                harness.calls.push("migrate");
                return { applied: [] };
            },
            async status() {
                harness.calls.push("status");
                return {
                    pending: [{ id: "999_pending" }],
                    dirty: [],
                    drift: [],
                    unknown: []
                };
            }
        }
    });

    await assert.rejects(
        bootstrap(harness.dependencies),
        (error) => error.code === "MIGRATIONS_PENDING"
    );
    assert.equal(harness.calls.includes("listen"), false);
    assert.deepEqual(harness.calls, [
        "ping",
        "migrate",
        "status",
        "failed",
        "close"
    ]);
});

test("FT-03: bereit wird erst nach Ping, Migration und sauberem Status gelauscht", async () => {
    const harness = createBootstrapHarness();
    const result = await bootstrap(harness.dependencies);

    assert.deepEqual(harness.calls, [
        "ping",
        "migrate",
        "status",
        "ready",
        "create_app",
        "listen"
    ]);
    assert.deepEqual(result.server, { name: "server" });
});

async function withHttpApp(readiness, callback) {
    const app = createApp({ readiness, logger: silentLogger(), includeRoutes: false });
    const server = await new Promise((resolve) => {
        const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    openServers.add(server);
    const address = server.address();

    return callback(`http://127.0.0.1:${address.port}`);
}

test("FT-03: liveness bleibt unabhängig von DB und Migrationen verfügbar", async () => {
    let checks = 0;
    const readiness = {
        async check() {
            checks += 1;
            throw new Error("must not be called by liveness");
        }
    };

    await withHttpApp(readiness, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/health/live`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { status: "live" });
        assert.equal(response.headers.get("cache-control"), "no-store");
    });
    assert.equal(checks, 0);
});

test("FT-03: readiness ist bei DB-Ausfall 503 und verrät keine internen Details", async () => {
    const probe = createReadinessProbe({
        async ping() {
            throw new Error("password=hunter2 host=internal-db");
        },
        async migrationStatus() {
            return { pending: [], dirty: [], drift: [], unknown: [] };
        }
    });
    probe.markReady();

    await withHttpApp(probe, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/health/ready`);
        const body = await response.json();
        assert.equal(response.status, 503);
        assert.deepEqual(body, {
            status: "not_ready",
            reason: "database_unavailable"
        });
        assert.equal(JSON.stringify(body).includes("hunter2"), false);
        assert.equal(JSON.stringify(body).includes("internal-db"), false);
    });
});

test("FT-03: readiness erkennt Migrationsrückstand und Legacy-Health bleibt kompatibel", async () => {
    const probe = createReadinessProbe({
        async ping() {},
        async migrationStatus() {
            return {
                pending: [{ id: "999_pending" }],
                dirty: [],
                drift: [],
                unknown: []
            };
        }
    });
    probe.markReady();

    await withHttpApp(probe, async (baseUrl) => {
        for (const path of ["/api/health/ready", "/api/health"]) {
            const response = await fetch(`${baseUrl}${path}`);
            assert.equal(response.status, 503);
            assert.deepEqual(await response.json(), {
                status: "not_ready",
                reason: "migrations_pending"
            });
        }
    });
});

test("FT-03: readiness liefert 200 erst bei erreichbarer DB und sauberem Schema", async () => {
    const probe = createReadinessProbe({
        async ping() {},
        async migrationStatus() {
            return { pending: [], dirty: [], drift: [], unknown: [] };
        }
    });
    probe.markReady();

    await withHttpApp(probe, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/health/ready`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { status: "ready" });
    });
});
