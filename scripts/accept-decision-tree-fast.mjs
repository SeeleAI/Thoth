import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const prebuilt = process.argv.includes("--prebuilt") || process.env.THOTH_ACCEPT_PREBUILT === "1";
const deadlineMs = 300_000;
const startedAt = Date.now();

const phases = [
  ...(prebuilt ? [] : [{ name: "protocol build", command: npm, args: ["run", "build:protocol"] }]),
  {
    name: "Decision Tree protocol",
    command: npm,
    args: [
      "run",
      "test",
      "--workspace=@thoth/protocol",
      "--",
      "src/messages.thoth-turn-snapshot.test.ts",
      "src/thoth-runtime-contract.test.ts",
      "src/thoth/rpc-schemas.test.ts",
      "src/rpc-registry.test.ts",
    ],
  },
  {
    name: "Decision Tree client SDK",
    command: npm,
    args: ["run", "test", "--workspace=@thoth/client", "--", "src/daemon-client.test.ts"],
  },
  {
    name: "authority, migration, and ToolGateway",
    command: npm,
    args: [
      "run",
      "test:unit",
      "--workspace=@thoth/daemon",
      "--",
      "src/server/agent/runtime-tool-decisions.test.ts",
      "src/server/agent/tools/thoth-tools.test.ts",
      "src/server/storage-layout-migration.test.ts",
      "src/server/workspace-authority/workspace-authority-store.test.ts",
    ],
  },
  {
    name: "provider adapter public journey",
    command: npm,
    args: ["run", "test:e2e:foreground-thoth", "--workspace=@thoth/daemon"],
  },
  {
    name: "Decision Tree app presentation",
    command: npm,
    args: [
      "run",
      "test",
      "--workspace=@thoth/app",
      "--",
      "src/composer/agent-controls/runtime-controls.test.tsx",
      "src/composer/agent-controls/thoth-mode.test.ts",
      "src/components/decision-tree-layout.test.ts",
      "src/components/decision-tree-sidebar.test.tsx",
      "src/components/decision-card-timeline-receipt.test.tsx",
      "src/agent-thoth/foreground-state.test.ts",
    ],
  },
  {
    name: "Decision Tree architecture contract",
    command: process.execPath,
    args: ["scripts/check-thoth-cognition-architecture.mjs"],
  },
];

for (const [index, phase] of phases.entries()) {
  const remainingMs = deadlineMs - (Date.now() - startedAt);
  if (remainingMs <= 0) throw new Error(`300s deadline expired before ${phase.name}`);
  const phaseStartedAt = Date.now();
  console.log(`\n[decision-tree-fast ${index + 1}/${phases.length}] ${phase.name}`);
  await run(phase, remainingMs);
  console.log(`[decision-tree-fast] ${phase.name} passed in ${seconds(phaseStartedAt)}s`);
}

console.log(`\n[decision-tree-fast] passed in ${seconds(startedAt)}s`);

function run(phase, remainingMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(phase.command, phase.args, {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, remainingMs);
    timer.unref();
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) rejectPromise(new Error(`${phase.name} exceeded the shared deadline`));
      else if (code !== 0)
        rejectPromise(new Error(`${phase.name} failed with ${signal ?? `exit ${code}`}`));
      else resolvePromise();
    });
  });
}

function seconds(since) {
  return ((Date.now() - since) / 1_000).toFixed(3);
}
