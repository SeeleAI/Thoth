#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stage = JSON.parse(readFileSync(resolve(repoRoot, "scripts/refactor-stage.json"), "utf8"));
const failures = [];

if (!Number.isInteger(stage.stage) || stage.stage < 0 || stage.stage > 7) {
  failures.push(`Invalid refactor stage: ${stage.stage}`);
}

if (stage.stage >= 1) {
  requirePath("packages/core/src/index.ts");
  forbidText("packages/daemon/src", /\bauthority_events\b/, "authority_events duplicate log");
}

if (stage.stage >= 2) {
  for (const path of [
    "packages/daemon/src/server/agent/agent-manager.ts",
    "packages/drivers/src/harness/hosted-adapter.ts",
    "packages/daemon/src/server/workspace-authority/agent-manager-harness-host.ts",
  ]) {
    forbidPath(path);
  }
  forbidText(
    "packages/daemon/src",
    /\b(AgentClient|AgentSession|AgentManager|HostedHarnessAdapter|AgentManagerHarnessHost)\b/,
    "legacy AgentManager harness chain",
  );
}

if (stage.stage >= 3) requirePath("packages/protocol/src/rpc-registry.ts");

if (stage.stage >= 4) {
  requirePath("packages/app/src/stores/authority-projection-store.ts");
  forbidPath("packages/app/src/stores/session-store.ts");
}

if (stage.stage >= 5) requirePath("packages/app/src/agent-stream/timeline-view-registry.tsx");
if (stage.stage >= 6) requirePath("packages/daemon/src/services/vcs-application-service.ts");

if (stage.stage >= 7) {
  requirePath("packages/daemon/src/server/service-supervisor.ts");
  const daemonPackage = JSON.parse(
    readFileSync(resolve(repoRoot, "packages/daemon/package.json"), "utf8"),
  );
  for (const dependency of ["openai", "ai", "@anthropic-ai/sdk"]) {
    if (daemonPackage.dependencies?.[dependency])
      failures.push(`Daemon still declares ${dependency}`);
  }
}

forbidCoreRuntimeLeaks();

if (failures.length > 0) {
  console.error(`Refactor architecture contract failed at stage ${stage.stage}:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Refactor architecture stage ${stage.stage} (${stage.name}) verified.`);

function requirePath(path) {
  if (!existsSync(resolve(repoRoot, path))) failures.push(`Missing final path ${path}`);
}

function forbidPath(path) {
  if (existsSync(resolve(repoRoot, path))) failures.push(`Legacy path still exists: ${path}`);
}

function forbidText(root, pattern, label) {
  let output = "";
  try {
    output = execFileSync("rg", ["-n", "--glob", "*.ts", "--glob", "*.tsx", pattern.source, root], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  if (output) failures.push(`${label} remains:\n${output.split("\n").slice(0, 8).join("\n")}`);
}

function forbidCoreRuntimeLeaks() {
  const coreSrc = resolve(repoRoot, "packages/core/src");
  if (!existsSync(coreSrc)) return;
  let output = "";
  try {
    output = execFileSync(
      "rg",
      [
        "-n",
        "--glob",
        "*.ts",
        "--glob",
        "*.tsx",
        "from [\\\"'](react|react-native|electron|@anthropic-ai|openai|@opencode-ai|@agentclientprotocol)",
        "packages/core/src",
      ],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  if (output) failures.push(`Core imports runtime/UI/provider dependencies:\n${output}`);
}
