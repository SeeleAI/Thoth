import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const startedAt = Date.now();
const deadlineMs = 300_000;
const phases = [
  {
    name: "protocol",
    command: npm,
    args: ["run", "test", "--workspace=@thoth/protocol", "--", "src/provider-control.test.ts"],
  },
  {
    name: "native Plan adapter",
    command: npm,
    args: [
      "run",
      "test",
      "--workspace=@thoth/drivers",
      "--",
      "src/server/agent/providers/codex-app-server-agent.test.ts",
      "src/server/agent/providers/codex-app-server-agent.features.test.ts",
    ],
  },
  {
    name: "Agent authority",
    command: npm,
    args: [
      "run",
      "test:unit",
      "--workspace=@thoth/daemon",
      "--",
      "src/server/workspace-authority/workspace-authority-store.test.ts",
      "src/server/agent/agent-manager.test.ts",
    ],
  },
  {
    name: "App controls and archive",
    command: npm,
    args: [
      "run",
      "test",
      "--workspace=@thoth/app",
      "--",
      "src/composer/agent-controls/runtime-controls.test.tsx",
      "src/screens/workspace/workspace-bulk-close.test.ts",
      "src/utils/agent-snapshots.test.ts",
    ],
  },
  {
    name: "product and Release contract",
    command: process.execPath,
    args: ["scripts/check-provider-plan-tabs-contract.mjs"],
  },
];

for (const [index, phase] of phases.entries()) {
  const remaining = deadlineMs - (Date.now() - startedAt);
  if (remaining <= 0) throw new Error(`Deadline expired before ${phase.name}`);
  const phaseStartedAt = Date.now();
  console.log(`\n[plan-tabs ${index + 1}/${phases.length}] ${phase.name}`);
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(phase.command, phase.args, {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    const timer = setTimeout(() => child.kill("SIGTERM"), remaining);
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${phase.name} failed with exit ${code}`));
    });
  });
  console.log(`[plan-tabs] ${phase.name} ${(Date.now() - phaseStartedAt) / 1000}s`);
}

console.log(`\n[plan-tabs] passed in ${((Date.now() - startedAt) / 1000).toFixed(3)}s`);
