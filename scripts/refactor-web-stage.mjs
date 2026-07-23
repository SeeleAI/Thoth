#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stageId = createHash("sha256").update(repoRoot).digest("hex").slice(0, 12);
const stageRoot = resolve(
  process.env.THOTH_REFACTOR_WEB_STAGE ?? `/tmp/thoth-refactor-web-${stageId}`,
);
const markerPath = resolve(stageRoot, ".thoth-refactor-web-cache.json");

export async function buildRefactorWebStage() {
  requirePreparedDependencies();
  await syncSources();
  await run("npm", ["run", "build:web:prepared"], { cwd: stageRoot });
  return getBuiltRefactorWebStage();
}

export function getBuiltRefactorWebStage() {
  requirePreparedDependencies();
  const dist = resolve(stageRoot, "packages/app/dist");
  if (!existsSync(resolve(dist, "index.html"))) {
    throw new Error(`Refactor Web stage has not been built at ${dist}`);
  }
  return { root: stageRoot, dist };
}

export async function prepareRefactorWebDependencies() {
  if (hasCurrentDependencies()) return stageRoot;
  mkdirSync(stageRoot, { recursive: true });
  await syncDirectory(resolve(repoRoot, "node_modules"), resolve(stageRoot, "node_modules"));
  writeMarker();
  return stageRoot;
}

function requirePreparedDependencies() {
  if (hasCurrentDependencies()) return;
  throw new Error(
    `Local Web dependency cache is missing or stale at ${stageRoot}. Run npm run setup:refactor-web-cache before the timed acceptance gate.`,
  );
}

function hasCurrentDependencies() {
  if (!existsSync(markerPath)) return false;
  try {
    const marker = JSON.parse(readFileSync(markerPath, "utf8"));
    return (
      marker.schemaVersion === 1 &&
      marker.signature === dependencySignature() &&
      existsSync(resolve(stageRoot, "node_modules/expo/package.json")) &&
      existsSync(resolve(stageRoot, "node_modules/react/package.json"))
    );
  } catch {
    return false;
  }
}

function adoptRefactorWebDependencies() {
  const sourceInstallLock = resolve(repoRoot, "node_modules/.package-lock.json");
  const stagedInstallLock = resolve(stageRoot, "node_modules/.package-lock.json");
  if (
    !existsSync(sourceInstallLock) ||
    !existsSync(stagedInstallLock) ||
    fileDigest(sourceInstallLock) !== fileDigest(stagedInstallLock)
  ) {
    throw new Error("Cannot adopt local Web dependencies: installed package locks do not match");
  }
  writeMarker();
}

function writeMarker() {
  writeFileSync(
    markerPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        signature: dependencySignature(),
        node: process.version,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function dependencySignature() {
  const hash = createHash("sha256");
  hash.update(process.version);
  hash.update(readFileSync(resolve(repoRoot, "package-lock.json")));
  return hash.digest("hex");
}

function fileDigest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function syncSources() {
  mkdirSync(stageRoot, { recursive: true });
  await run(
    "rsync",
    [
      "-a",
      "--delete",
      "--exclude=/.git/",
      "--exclude=/.dev/",
      "--exclude=/.agent-os/upstreams/",
      "--exclude=/.agent-os/artifacts/",
      "--exclude=/.agent-os/paper-notes/",
      "--exclude=/.thoth-refactor-web-cache.json",
      "--exclude=node_modules/",
      "--exclude=packages/app/dist/",
      "--exclude=packages/app/test-results/",
      "--exclude=packages/app/android/",
      "--exclude=packages/app/ios/",
      "--exclude=packages/daemon/dist/",
      "--exclude=packages/desktop/release/",
      `${repoRoot}/`,
      `${stageRoot}/`,
    ],
    { cwd: repoRoot },
  );
}

async function syncDirectory(source, destination) {
  if (!existsSync(source)) throw new Error(`Missing dependency directory: ${source}`);
  mkdirSync(destination, { recursive: true });
  await run("rsync", ["-a", "--delete", `${source}/`, `${destination}/`], { cwd: repoRoot });
}

function run(command, args, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${command} ${args.join(" ")} failed with ${signal ?? code}`));
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2];
  if (command === "--prepare-dependencies") {
    await prepareRefactorWebDependencies();
  } else if (command === "--adopt-dependencies") {
    adoptRefactorWebDependencies();
  } else if (command === "--build") {
    const result = await buildRefactorWebStage();
    console.log(result.dist);
  } else if (command === "--print-stage") {
    console.log(stageRoot);
  } else {
    throw new Error(
      "Usage: refactor-web-stage.mjs --prepare-dependencies|--adopt-dependencies|--build|--print-stage",
    );
  }
}
