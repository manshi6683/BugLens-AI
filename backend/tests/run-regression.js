
const { spawn } = require("node:child_process");
const { tmpdir } = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const DB_PATH = path.join(
  tmpdir(),
  `buglens-test-${process.pid}-${Date.now()}.db`
);

const PORT = 5501;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let child;
let shuttingDown = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Test server exited with code ${child.exitCode}`);
    }

    try {
      const response = await fetch(`${BASE_URL}/api/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }

    await sleep(250);
  }

  throw new Error("Test server did not start within 15 seconds");
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;

  child.kill();

  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(3000),
  ]);
}

function removeTemporaryDatabase() {
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = DB_PATH + suffix;
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (error) {
      console.error(`Could not remove temporary file ${file}:`, error.message);
    }
  }
}

async function main() {
  child = spawn(process.execPath, ["server.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      BUGLENS_DB_PATH: DB_PATH,
      PORT: String(PORT),
    },
    stdio: "inherit",
  });

  child.on("error", (error) => {
    console.error("Could not start test server:", error);
  });

  try {
    await waitForServer();

    console.log("\nRunning isolated BugLens AI regression tests...\n");

    const result = spawn(
      process.execPath,
      ["--test", "tests/*.test.js"],
      {
        cwd: path.resolve(__dirname, ".."),
        env: {
          ...process.env,
          BUGLENS_TEST_BASE_URL: BASE_URL,
        },
        stdio: "inherit",
      }
    );

    const exitCode = await new Promise((resolve, reject) => {
      result.on("error", reject);
      result.on("exit", (code) => resolve(code ?? 1));
    });

    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  } finally {
    await stopServer();
    removeTemporaryDatabase();
    console.log("\nTemporary test database cleanup completed.");
  }
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
  await stopServer();
  removeTemporaryDatabase();
});
