import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const deadlineMs = 300_000;
const startedAt = Date.now();

const phases = [
  {
    name: "queue protocol",
    command: npm,
    args: [
      "run",
      "test",
      "--workspace=@thoth/protocol",
      "--",
      "src/messages.agent-turn-queue.test.ts",
    ],
  },
  {
    name: "provider rewind receipts",
    command: npm,
    args: [
      "run",
      "test",
      "--workspace=@thoth/drivers",
      "--",
      "src/server/agent/providers/codex-app-server-agent.test.ts",
      "src/server/agent/providers/claude/rewind.test.ts",
      "src/server/agent/providers/opencode/rewind.test.ts",
    ],
  },
  {
    name: "Workspace queue and rewind authority",
    command: npm,
    args: [
      "run",
      "test:unit",
      "--workspace=@thoth/daemon",
      "--",
      "src/server/agent/rewind/rewind.test.ts",
      "src/server/workspace-authority/workspace-authority-store.test.ts",
    ],
  },
  {
    name: "canonical provider anchor capture",
    command: npm,
    args: [
      "run",
      "test:unit",
      "--workspace=@thoth/daemon",
      "--",
      "src/server/agent/execution-service.test.ts",
      "--testNamePattern=canonical message id",
    ],
  },
  {
    name: "public queue lifecycle",
    command: npm,
    args: [
      "run",
      "test:e2e:foreground-thoth",
      "--workspace=@thoth/daemon",
      "--",
      "--testNamePattern=UT-02c|UT-03 preserves",
    ],
  },
  {
    name: "binary file client",
    command: npm,
    args: [
      "run",
      "test",
      "--workspace=@thoth/client",
      "--",
      "src/daemon-client.test.ts",
      "--testNamePattern=readFile",
    ],
  },
  {
    name: "App composer settings and preview",
    command: npm,
    args: [
      "run",
      "test",
      "--workspace=@thoth/app",
      "--",
      "src/composer/actions.test.ts",
      "src/hooks/use-settings/storage.test.ts",
      "src/file-explorer/use-file-preview-source.test.tsx",
      "src/hooks/use-app-visible.test.tsx",
    ],
  },
  {
    name: "static single-authority contract",
    command: process.execPath,
    args: ["scripts/check-interaction-regressions-contract.mjs"],
  },
];

function seconds(since) {
  return ((Date.now() - since) / 1000).toFixed(3);
}

async function runPhase(phase, index) {
  const remainingMs = deadlineMs - (Date.now() - startedAt);
  if (remainingMs <= 0) throw new Error(`300s deadline expired before ${phase.name}`);
  const phaseStartedAt = Date.now();
  console.log(
    `\n[interaction-accept ${index + 1}/${phases.length}] ${phase.name} (remaining ${(
      remainingMs / 1000
    ).toFixed(1)}s)`,
  );
  await new Promise((resolvePromise, rejectPromise) => {
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
      else if (code !== 0) rejectPromise(new Error(`${phase.name} failed with ${signal ?? code}`));
      else resolvePromise();
    });
  });
  console.log(`[interaction-accept] ${phase.name} passed in ${seconds(phaseStartedAt)}s`);
}

try {
  for (let index = 0; index < phases.length; index += 1) {
    await runPhase(phases[index], index);
  }
  console.log(`\n[interaction-accept] passed in ${seconds(startedAt)}s`);
} catch (error) {
  console.error(`\n[interaction-accept] FAILED after ${seconds(startedAt)}s:`, error);
  process.exit(1);
}
