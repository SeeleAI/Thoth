import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fullThoth = process.argv.includes("--all");
const prebuilt = process.env.THOTH_ACCEPT_PREBUILT === "1";
const deadlineMs = 300_000;
const startedAt = Date.now();
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const targetedForegroundPattern = "UT-02b|UT-04|UT-05|Harness lifecycle conformance";

const phases = [
  ...(prebuilt ? [] : [{ name: "protocol build", command: npm, args: ["run", "build:protocol"] }]),
  {
    name: "protocol snapshots",
    command: npm,
    args: [
      "run",
      "test",
      "--workspace=@thoth/protocol",
      "--",
      "src/messages.thoth-turn-snapshot.test.ts",
    ],
  },
  {
    name: "native adapter transports",
    command: npm,
    args: [
      "run",
      "test",
      "--workspace=@thoth/drivers",
      "--",
      "src/harness/hosted-adapter.test.ts",
      "src/server/agent/providers/claude/agent.redesign.test.ts",
      "src/server/agent/providers/opencode-agent.test.ts",
      "src/server/agent/providers/acp-agent.test.ts",
      "src/server/agent/providers/pi/agent.test.ts",
      "src/server/agent/providers/codex-app-server-agent.test.ts",
    ],
  },
  {
    name: "approval authority",
    command: npm,
    args: [
      "run",
      "test:unit",
      "--workspace=@thoth/daemon",
      "--",
      "src/server/workspace-authority/execution-approval-controller.test.ts",
      "src/server/workspace-authority/workspace-authority-store.test.ts",
      "src/server/workspace-authority/task-coordinator.test.ts",
      "src/server/agent/agent-prompt.test.ts",
    ],
  },
  {
    name: "update recovery",
    command: npm,
    args: [
      "run",
      "test:unit",
      "--workspace=@thoth/daemon",
      "--",
      "src/server/session.workspaces.test.ts",
      "--testNamePattern=fetch_agent_request",
    ],
  },
  {
    name: "public Plan and Loop API",
    command: npm,
    args: fullThoth
      ? ["run", "test:e2e:foreground-thoth", "--workspace=@thoth/daemon"]
      : [
          "run",
          "test:e2e:foreground-thoth",
          "--workspace=@thoth/daemon",
          "--",
          `--testNamePattern=${targetedForegroundPattern}`,
        ],
  },
  {
    name: "typed client recovery",
    command: npm,
    args: ["run", "test", "--workspace=@thoth/client", "--", "src/daemon-client.test.ts"],
  },
  {
    name: "App provider controls",
    command: npm,
    args: [
      "run",
      "test",
      "--workspace=@thoth/app",
      "--",
      "src/composer/agent-controls/runtime-controls.test.tsx",
      "src/composer/agent-controls/utils.test.ts",
      "src/hooks/feature-preferences.test.ts",
      "src/hooks/use-form-preferences.test.ts",
      "src/panels/background-tasks-panel.test.tsx",
      "src/stores/workspace-layout-store.test.ts",
      ...(fullThoth
        ? ["src/stores/background-tasks-surface-store.test.ts", "src/composer/task-context.test.ts"]
        : []),
    ],
  },
  ...(fullThoth
    ? [
        {
          name: "Provider Plan and tab archive",
          command: process.execPath,
          args: ["scripts/accept-provider-plan-tabs-fast.mjs"],
        },
        {
          name: "interaction regressions",
          command: process.execPath,
          args: ["scripts/accept-interaction-regressions-fast.mjs"],
        },
        {
          name: "extended Task authority",
          command: npm,
          args: [
            "run",
            "test:unit",
            "--workspace=@thoth/daemon",
            "--",
            "src/server/storage-layout-migration.test.ts",
            "src/server/workspace-authority/task-coordinator.test.ts",
            "src/server/workspace-authority/task-context-broker.test.ts",
          ],
        },
      ]
    : []),
  {
    name: "static architecture contract",
    command: process.execPath,
    args: ["scripts/check-provider-control-contract.mjs"],
  },
];

function elapsedSeconds(since) {
  return ((Date.now() - since) / 1000).toFixed(3);
}

async function runPhase(phase, index) {
  const remainingMs = deadlineMs - (Date.now() - startedAt);
  if (remainingMs <= 0) {
    throw new Error(`300s deadline expired before ${phase.name}`);
  }
  const phaseStartedAt = Date.now();
  console.log(
    `\n[fast-accept ${index + 1}/${phases.length}] ${phase.name} (remaining ${(remainingMs / 1000).toFixed(1)}s)`,
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
      if (timedOut) {
        rejectPromise(new Error(`${phase.name} exceeded the shared 300s deadline`));
      } else if (code !== 0) {
        rejectPromise(new Error(`${phase.name} failed with ${signal ?? `exit ${code}`}`));
      } else {
        resolvePromise();
      }
    });
  });
  console.log(`[fast-accept] ${phase.name} passed in ${elapsedSeconds(phaseStartedAt)}s`);
}

try {
  for (let index = 0; index < phases.length; index += 1) {
    await runPhase(phases[index], index);
  }
  console.log(
    `\n[fast-accept] ${fullThoth ? "Thoth" : "Provider control"} passed in ${elapsedSeconds(startedAt)}s`,
  );
} catch (error) {
  console.error(`\n[fast-accept] FAILED after ${elapsedSeconds(startedAt)}s:`, error);
  process.exit(1);
}
