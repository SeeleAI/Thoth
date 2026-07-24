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
  requirePath("packages/core/src/authority.ts");
  requirePath("packages/daemon/src/server/storage-schema.ts");
  forbidPath("packages/daemon/src/server/workspace-authority/task-identity.ts");
  for (const path of [
    "packages/daemon/src/server/storage-schema.ts",
    "packages/daemon/src/server/workspace-authority/workspace-authority-store.ts",
  ]) {
    forbidText(path, /\bauthority_events\b/, "authority_events runtime path");
  }
  for (const path of [
    "packages/daemon/src/server/workspace-authority/catalog-store.ts",
    "packages/daemon/src/server/workspace-authority/coordination-repository.ts",
    "packages/daemon/src/server/workspace-authority/workspace-authority-store.ts",
  ]) {
    forbidText(path, /\b(CREATE TABLE|ALTER TABLE|ensureColumn)\b/, "constructor/runtime DDL");
  }
  forbidText(
    "packages/daemon/src/server/workspace-authority/workspace-authority-store.ts",
    /\b(importLegacyForeground|importLegacyTaskMemory|importLegacyExecution|importLegacyTaskDecision)\b/,
    "pre-Release import API",
  );
  const daemonPackage = JSON.parse(
    readFileSync(resolve(repoRoot, "packages/daemon/package.json"), "utf8"),
  );
  if (!daemonPackage.dependencies?.["@thoth/core"]) failures.push("Daemon does not depend on Core");
  for (const dependency of ["openai", "@anthropic-ai/sdk"]) {
    if (daemonPackage.dependencies?.[dependency])
      failures.push(`Daemon still declares ${dependency}`);
  }
}

if (stage.stage >= 2) {
  for (const path of [
    "packages/drivers/src/server/agent/harness-contract.ts",
    "packages/drivers/src/server/agent/provider-registry.ts",
    "packages/daemon/src/server/agent/execution-service.ts",
    "packages/daemon/src/server/workspace-authority/tool-gateway.ts",
  ]) {
    requirePath(path);
  }
  for (const path of [
    "packages/daemon/src/server/agent/agent-manager.ts",
    "packages/daemon/src/server/agent/tools/foreground-turn-fence.ts",
    "packages/daemon/src/server/test-utils/fake-agent-client.ts",
    "packages/drivers/src/harness/hosted-adapter.ts",
    "packages/drivers/src/harness/registry.ts",
    "packages/drivers/src/server/agent/agent-sdk-types.ts",
    "packages/daemon/src/server/workspace-authority/agent-manager-harness-host.ts",
    "packages/daemon/src/server/workspace-authority/task-tool-gateway.ts",
  ]) {
    forbidPath(path);
  }
  forbidText(
    "packages/daemon/src",
    /\b(AgentClient|AgentSession|AgentManager|HostedHarnessAdapter|AgentManagerHarnessHost)\b/,
    "legacy AgentManager harness chain",
  );
  forbidText(
    "packages/drivers/src/server/agent/provider-registry.ts",
    /^import\s.+from\s+["']\.\/providers\//,
    "static Provider implementation import",
  );
  forbidText(
    "packages/drivers/src/server/agent/provider-registry.ts",
    /\b(PROVIDER_REGISTRY|createAllAdapters|loadAdaptersFromRegistry|shutdownProviders)\b/,
    "eager Provider registry compatibility API",
  );
  forbidProductionText(
    "packages/daemon/src",
    /from\s+["'](?:@agentclientprotocol\/sdk|@anthropic-ai\/claude-agent-sdk|@opencode-ai\/sdk)["']/,
    "Daemon production import of a Provider SDK",
  );
  for (const path of [
    "packages/daemon/src/server/agent/execution-service.ts",
    "packages/daemon/src/server/agent/foreground-turn-coordinator.ts",
    "packages/daemon/src/server/workspace-authority/task-coordinator.ts",
    "packages/daemon/src/server/workspace-authority/task-orchestrator.ts",
    "packages/daemon/src/server/workspace-authority/tool-gateway.ts",
  ]) {
    forbidText(
      path,
      /["'`](?:codex|claude|opencode|pi|omp|copilot|cursor)["'`]/,
      "Provider identity branch in application orchestration",
    );
  }
  requireOnlyToolGatewayConstruction();
}

if (stage.stage >= 3) {
  requirePath("packages/protocol/src/rpc-registry.ts");
  requirePath("packages/protocol/src/rpc-registry.test.ts");
  forbidPath("packages/protocol/src/rpc-registry-core.ts");
  requireText(
    "packages/protocol/src/messages.ts",
    /export const rpcRegistry = defineRpcRegistry/,
    "Protocol RPC Registry declaration",
  );
  requireText(
    "packages/protocol/src/messages.ts",
    /SessionInboundMessageSchema = createRpcMessageUnion/,
    "Registry-derived inbound union",
  );
  requireText(
    "packages/protocol/src/messages.ts",
    /SessionOutboundMessageSchema = createRpcMessageUnion/,
    "Registry-derived outbound union",
  );
  forbidText(
    "packages/protocol/src/messages.ts",
    /Session(Inbound|Outbound)MessageSchema\s*=\s*z\.discriminatedUnion/,
    "hand-written Session message union",
  );
  requireText(
    "packages/client/src/daemon-client.ts",
    /const clientRpcBindings =/,
    "derived Client RPC bindings",
  );
  requireText(
    "packages/client/src/daemon-client.ts",
    /const RPC_INVOKE = Symbol\("rpc\.invoke"\)/,
    "single Client RPC broker",
  );
  forbidText(
    "packages/client/src/daemon-client.ts",
    /\b(sendCorrelatedRequest|sendCorrelatedSessionRequest|sendNamespacedCorrelatedSessionRequest)\b/,
    "legacy Client correlated-request helper",
  );
  forbidText(
    "packages/client/src/daemon-client.ts",
    /responseType:\s*["']/,
    "hand-written Client response type",
  );
  requireText(
    "packages/daemon/src/server/session.ts",
    /private createRpcHandlers\(\): SessionRpcHandlers/,
    "typed Daemon RPC handler table",
  );
  requireText(
    "packages/daemon/src/server/session.ts",
    /rpcRegistry\.operationForRequestType\(msg\.type\)/,
    "Registry-driven Daemon dispatch",
  );
  forbidText(
    "packages/daemon/src/server/session.ts",
    /switch\s*\(\s*msg\.type\s*\)/,
    "hand-written Daemon request switch",
  );
  forbidText(
    "packages/daemon/src/server/session.ts",
    /\bdispatch(Control|AgentRewind|AgentRelationship|AgentTimeline|AgentLifecycle|AgentConfig|TaskAuthority|Checkout|WorkspaceAndProject|Provider|Terminal|ChatSchedule|Misc)Message\b/,
    "legacy grouped Daemon dispatch",
  );
  requireText(
    "packages/protocol/src/rpc-registry.test.ts",
    /toHaveLength\(131\)/,
    "131 inbound RPC coverage assertion",
  );
  requireText(
    "packages/protocol/src/rpc-registry.test.ts",
    /toHaveLength\(139\)/,
    "139 outbound RPC/event coverage assertion",
  );
  for (const binaryType of ["file_begin", "file_chunk", "file_end", "terminal_frame"]) {
    requireText(
      "packages/protocol/src/rpc-registry.test.ts",
      new RegExp(`"${binaryType}"`),
      `${binaryType} binary-codec isolation assertion`,
    );
  }
}

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

function requireText(path, pattern, label) {
  const absolutePath = resolve(repoRoot, path);
  if (!existsSync(absolutePath) || !pattern.test(readFileSync(absolutePath, "utf8"))) {
    failures.push(`Missing ${label} in ${path}`);
  }
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

function forbidProductionText(root, pattern, label) {
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
        "--glob",
        "!*.test.ts",
        "--glob",
        "!*.test.tsx",
        "--glob",
        "!*.e2e.test.ts",
        pattern.source,
        root,
      ],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  if (output) failures.push(`${label} remains:\n${output.split("\n").slice(0, 8).join("\n")}`);
}

function requireOnlyToolGatewayConstruction() {
  let output = "";
  try {
    output = execFileSync(
      "rg",
      [
        "-l",
        "--glob",
        "*.ts",
        "--glob",
        "!*.test.ts",
        "--glob",
        "!*.e2e.test.ts",
        "--glob",
        "!**/test-utils/**",
        "new ToolGateway",
        "packages/daemon/src/server",
      ],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  const paths = output ? output.split("\n") : [];
  const expected = "packages/daemon/src/server/workspace-authority/task-orchestrator.ts";
  if (paths.length !== 1 || paths[0] !== expected) {
    failures.push(
      `ToolGateway must have one production construction site at ${expected}; found ${paths.join(", ") || "none"}`,
    );
  }
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
