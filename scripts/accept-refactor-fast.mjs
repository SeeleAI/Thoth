#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const deadlineMs = 300_000;
const startedAt = Date.now();
const stage = JSON.parse(readFileSync(resolve(repoRoot, "scripts/refactor-stage.json"), "utf8"));

const sourceArgs = [
  "scripts/refactor-source-metrics.mjs",
  "--baseline",
  "scripts/refactor-baseline.json",
];
if (stage.stage >= 1) sourceArgs.push("--require-net-negative");
if (stage.stage >= 7) sourceArgs.push("--require-target", "50000");

try {
  await runGroup("static contracts", [
    command(process.execPath, ["scripts/check-refactor-architecture.mjs"]),
    command(process.execPath, ["scripts/refactor-storage-fixture.mjs", "--verify"]),
    command(process.execPath, sourceArgs),
    command("git", ["diff", "--check"]),
  ]);

  await runGroup("foundation", [command(npm, ["run", "check:foundation"])]);

  await runGroup("runtime dependency build", [
    command(npm, ["run", "build", "--workspace=@thoth/core"]),
    command(npm, ["run", "test", "--workspace=@thoth/core"]),
    command(npm, ["run", "build", "--workspace=@thoth/drivers"]),
    command(npm, ["run", "build", "--workspace=@thoth/tui"]),
  ]);

  await runGroup("daemon and real web build", [
    command(npm, ["run", "build", "--workspace=@thoth/daemon"]),
    command(process.execPath, ["scripts/refactor-web-stage.mjs", "--build"]),
  ]);

  await runGroup("behavior and real web contracts", [
    command(npm, ["run", "accept:thoth:fast"], { THOTH_ACCEPT_PREBUILT: "1" }),
    command(npm, ["run", "accept:refactor:visual"], {
      THOTH_ACCEPT_PREBUILT: "1",
      THOTH_ACCEPT_WEB_STAGE_PREBUILT: "1",
      THOTH_REFACTOR_VISUAL_MODE: "scorecard",
    }),
    command(npm, ["run", "smoke:tui:navigation"]),
  ]);

  await runGroup("exclusive App performance sampling", [
    command(npm, ["run", "accept:refactor:visual"], {
      THOTH_ACCEPT_PREBUILT: "1",
      THOTH_ACCEPT_WEB_STAGE_PREBUILT: "1",
      THOTH_REFACTOR_VISUAL_MODE: "performance",
    }),
  ]);

  const appPerformanceArgs = ["scripts/check-refactor-app-performance.mjs"];
  if (stage.stage >= 7) appPerformanceArgs.push("--final");
  await runGroup("App performance contract", [command(process.execPath, appPerformanceArgs)]);

  const performanceArgs = [
    "scripts/refactor-performance.mjs",
    "--baseline",
    "scripts/refactor-performance-baseline.json",
    "--write",
    ".dev/refactor-performance-current.json",
  ];
  if (stage.stage >= 7) performanceArgs.push("--final");
  await runGroup("isolated performance", [command(process.execPath, performanceArgs)]);

  if (stage.stage >= 7) {
    await runGroup("source Relay journey", [
      command(process.execPath, ["scripts/accept-refactor-relay.mjs"]),
    ]);
  }

  console.log(`\n[refactor] stage ${stage.stage} passed in ${seconds(startedAt)}s`);
} catch (error) {
  console.error(`\n[refactor] FAILED after ${seconds(startedAt)}s:`, error);
  process.exit(1);
}

function command(executable, args, env = {}) {
  return { executable, args, env, label: `${executable} ${args.join(" ")}` };
}

async function runGroup(name, commands) {
  const remaining = deadlineMs - (Date.now() - startedAt);
  if (remaining <= 0) throw new Error(`Shared deadline expired before ${name}`);
  const phaseStartedAt = Date.now();
  console.log(
    `\n[refactor] ${name} (${commands.length} command${commands.length === 1 ? "" : "s"})`,
  );
  await Promise.all(commands.map((entry) => runCommand(entry, remaining)));
  console.log(`[refactor] ${name} passed in ${seconds(phaseStartedAt)}s`);
}

function runCommand(entry, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(entry.executable, entry.args, {
      cwd: repoRoot,
      env: { ...process.env, ...entry.env },
      stdio: "inherit",
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, timeoutMs);
    timer.unref();
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) rejectPromise(new Error(`${entry.label} exceeded the shared deadline`));
      else if (code !== 0) rejectPromise(new Error(`${entry.label} failed with ${signal ?? code}`));
      else resolvePromise();
    });
  });
}

function seconds(since) {
  return ((Date.now() - since) / 1000).toFixed(3);
}
