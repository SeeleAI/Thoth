import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const prebuilt = process.argv.includes("--prebuilt") || process.env.THOTH_ACCEPT_PREBUILT === "1";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const deadlineMs = 300_000;
const startedAt = Date.now();
const phases = [
  ...(prebuilt ? [] : [{ name: "protocol build", command: npm, args: ["run", "build:protocol"] }]),
  {
    name: "Clarify and Loop protocol",
    command: npm,
    args: [
      "run",
      "test",
      "--workspace=@thoth/protocol",
      "--",
      "src/thoth-runtime-contract.test.ts",
      "src/thoth/rpc-schemas.test.ts",
      "src/rpc-registry.test.ts",
    ],
  },
  {
    name: "cognition golden evals",
    command: npm,
    args: [
      "run",
      "test",
      "--workspace=@thoth/drivers",
      "--",
      "src/clarify/eval.test.ts",
      "src/loop/eval.test.ts",
    ],
  },
  {
    name: "Workspace authority and semantic tools",
    command: npm,
    args: [
      "run",
      "test:unit",
      "--workspace=@thoth/daemon",
      "--",
      "src/server/storage-layout-migration.test.ts",
      "src/server/workspace-authority/workspace-authority-store.test.ts",
      "src/server/workspace-authority/task-coordinator.test.ts",
      "src/server/workspace-authority/task-context-broker.test.ts",
      "src/server/agent/tools/thoth-tools.test.ts",
    ],
  },
  {
    name: "public Clarify and Loop journey",
    command: npm,
    args: ["run", "test:e2e:foreground-thoth", "--workspace=@thoth/daemon"],
  },
  {
    name: "Decision Map and Task UI",
    command: npm,
    args: [
      "run",
      "test",
      "--workspace=@thoth/app",
      "--",
      "src/components/clarify-decision-card.test.tsx",
      "src/components/clarify-decision-map.test.tsx",
      "src/components/intent-contract-card.test.tsx",
      "src/panels/background-tasks-panel.test.tsx",
    ],
  },
  {
    name: "cognition architecture contract",
    command: process.execPath,
    args: ["scripts/check-thoth-cognition-architecture.mjs"],
  },
];

for (let index = 0; index < phases.length; index += 1) {
  const phase = phases[index];
  const remainingMs = deadlineMs - (Date.now() - startedAt);
  if (remainingMs <= 0) throw new Error(`300s deadline expired before ${phase.name}`);
  const phaseStartedAt = Date.now();
  console.log(`\n[cognition-fast ${index + 1}/${phases.length}] ${phase.name}`);
  await run(phase, remainingMs);
  console.log(`[cognition-fast] ${phase.name} passed in ${seconds(phaseStartedAt)}s`);
}
console.log(`\n[cognition-fast] passed in ${seconds(startedAt)}s`);

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
