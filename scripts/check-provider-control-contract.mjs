import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const violations = [];

function sourceFiles(root) {
  const files = [];
  for (const entry of readdirSync(root)) {
    const absolute = join(root, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      files.push(...sourceFiles(absolute));
    } else if (/\.(?:ts|tsx)$/.test(entry) && !/\.test\.|\.e2e\./.test(entry)) {
      files.push(absolute);
    }
  }
  return files;
}

function reject(file, pattern, reason) {
  const source = readFileSync(file, "utf8");
  if (pattern.test(source)) {
    violations.push(`${relative(repoRoot, file)}: ${reason}`);
  }
}

for (const file of sourceFiles(join(repoRoot, "packages/app/src"))) {
  reject(file, /\bplan_mode\b/, "App must use providerRunMode instead of a provider feature id");
}

const orchestrationFiles = [
  "packages/daemon/src/server/agent/foreground-turn-coordinator.ts",
  "packages/daemon/src/server/workspace-authority/task-coordinator.ts",
  "packages/daemon/src/server/workspace-authority/task-orchestrator.ts",
  "packages/daemon/src/server/workspace-authority/workspace-authority-store.ts",
];
for (const path of orchestrationFiles) {
  const file = join(repoRoot, path);
  reject(
    file,
    /["'`](?:codex|claude|opencode|pi|acp-fixture)["'`]/i,
    "orchestration must branch on Harness capabilities, never provider identity",
  );
  reject(
    file,
    /(?:simulate|pretend|emulate).{0,40}(?:native )?plan/i,
    "native Plan cannot be replaced with a prompt fallback",
  );
}

const contract = readFileSync(join(repoRoot, "packages/protocol/src/provider-control.ts"), "utf8");
for (const required of [
  'z.enum(["default", "plan"])',
  'kind: z.literal("native")',
  'kind: z.literal("unsupported")',
]) {
  if (!contract.includes(required)) {
    violations.push(`packages/protocol/src/provider-control.ts: missing ${required}`);
  }
}

if (violations.length > 0) {
  console.error(
    "Provider control contract failed:\n" + violations.map((item) => `- ${item}`).join("\n"),
  );
  process.exit(1);
}

console.log("Provider control contract passed.");
