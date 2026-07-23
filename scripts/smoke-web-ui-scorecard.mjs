#!/usr/bin/env node
import { spawn } from "node:child_process";
import { request } from "node:http";
import net from "node:net";
import { buildRefactorWebStage } from "./refactor-web-stage.mjs";

async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to acquire local port")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with ${signal ?? code}`));
    });
  });
}

async function waitForHttp(url, timeoutMs = 30_000) {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = request(url, (res) => {
          res.resume();
          if ((res.statusCode ?? 500) < 500) {
            resolve();
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
        req.setTimeout(1000, () => {
          req.destroy(new Error("HTTP wait timed out"));
        });
        req.on("error", reject);
        req.end();
      });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(
    `Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      resolve();
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

if (process.env.THOTH_ACCEPT_PREBUILT !== "1") {
  await run("npm", ["run", "build:daemon"]);
}
const webDist =
  process.env.THOTH_ACCEPT_WEB_PREBUILT === "1"
    ? "packages/app/dist"
    : (await buildRefactorWebStage()).dist;

const port = await getAvailablePort();
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  ["scripts/serve-static.mjs", webDist, String(port), "127.0.0.1"],
  {
    stdio: "inherit",
  },
);

try {
  await waitForHttp(baseUrl);
  await run(
    "npm",
    [
      "--workspace=@thoth/app",
      "run",
      "test:e2e",
      "--",
      "thoth-ui-scorecard.spec.ts",
      "refactor-app-performance.spec.ts",
      ...process.argv.slice(2),
    ],
    {
      env: {
        ...process.env,
        E2E_BASE_URL: baseUrl,
        THOTH_REFACTOR_APP_PERF_OUTPUT:
          process.env.THOTH_REFACTOR_APP_PERF_OUTPUT ??
          ".dev/refactor-app-performance-current.json",
      },
    },
  );
} finally {
  await stopProcess(server);
}
