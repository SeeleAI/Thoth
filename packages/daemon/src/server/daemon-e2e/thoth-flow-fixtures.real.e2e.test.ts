import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

import type {
  AgentThothLifecycle,
  ThothCardAnswerPayload,
  ThothClarifyCardModel,
  ThothIntentContractCardModel,
} from "@thoth/protocol/thoth/rpc-schemas";
import type { ThothTurnSnapshot } from "@thoth/protocol/messages";
import type { ExecutionProjection, TaskProjection } from "@thoth/protocol/task-authority";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestThothDaemon, type TestThothDaemon } from "../test-utils/thoth-daemon.js";
import {
  buildRealProviderFixturePrompt,
  THOTH_REAL_PROVIDER_FLOW_SCRIPTS,
  type ThothRealProviderFlowScript,
} from "../../test-fixtures/thoth-real-provider-flow-script.js";
import {
  canRunNativeCodexProvider,
  createNativeCodexProviderClient,
  getNativeCodexProviderConfig,
} from "./real-provider-test-config.js";

const FOREGROUND_TIMEOUT_MS = 180_000;
const LOOP_TIMEOUT_MS = 420_000;
const THOTH_RUNTIME_WORKSPACE_ENTRIES = new Set([".agents", ".codex", ".git"]);

interface FlowRuntime {
  daemon: TestThothDaemon;
  client: DaemonClient;
  cwd: string;
  workspaceId: string;
  dispose: () => Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFixtureLogger(): ReturnType<typeof pino> {
  const traceFile = process.env.THOTH_REAL_FLOW_TRACE_FILE?.trim();
  return traceFile
    ? pino({ level: "trace" }, pino.destination({ dest: traceFile, sync: false }))
    : pino({ level: "silent" });
}

async function createFlowRuntime(): Promise<FlowRuntime> {
  const logger = createFixtureLogger();
  const cwd = mkdtempSync(path.join(tmpdir(), "thoth-real-flow-workspace-"));
  const daemon = await createTestThothDaemon({
    harnessAdapters: { codex: createNativeCodexProviderClient(logger) },
    logger,
  });
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  try {
    await client.connect();
    await client.fetchAgents({ subscribe: { subscriptionId: "thoth-real-flow-fixtures" } });
    const configured = await client.patchDaemonConfig({
      appendSystemPrompt: [
        "You are participating in an automated Thoth transport verification.",
        "Follow a supplied THOTH REAL FLOW FIXTURE literally and call only its prescribed tools.",
        "Do not independently inspect or alter the Workspace.",
      ].join(" "),
    });
    if (configured.error) throw new Error(configured.error);
    const created = await client.createWorkspace({ source: { kind: "directory", path: cwd } });
    if (created.error || !created.workspace) {
      throw new Error(created.error ?? "Failed to create temporary flow Workspace");
    }
    return {
      daemon,
      client,
      cwd,
      workspaceId: created.workspace.id,
      dispose: async () => {
        await client.close().catch(() => undefined);
        await daemon.close().catch(() => undefined);
        rmSync(cwd, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await client.close().catch(() => undefined);
    await daemon.close().catch(() => undefined);
    rmSync(cwd, { recursive: true, force: true });
    throw error;
  }
}

async function configureFixture(
  runtime: FlowRuntime,
  script: ThothRealProviderFlowScript,
): Promise<string> {
  const fixturePrompt = buildRealProviderFixturePrompt({ script });
  const configured = await runtime.client.patchDaemonConfig({
    appendSystemPrompt: [
      "You are participating in an automated Thoth transport verification.",
      "The fixture applies to visible Clarify, the one-shot Challenger, Executor and fresh Review roles.",
      "Do not replace prescribed semantic arguments with your own wording and do not write fixture state directly.",
      fixturePrompt,
    ].join("\n\n"),
  });
  if (configured.error) throw new Error(configured.error);
  return fixturePrompt;
}

async function createFixtureAgent(input: {
  runtime: FlowRuntime;
  prompt: string;
  thoth: ThothTurnSnapshot;
}) {
  return input.runtime.client.createAgent({
    ...getNativeCodexProviderConfig(),
    cwd: input.runtime.cwd,
    workspaceId: input.runtime.workspaceId,
    initialPrompt: input.prompt,
    thoth: input.thoth,
  });
}

async function waitForState(
  runtime: FlowRuntime,
  agentId: string,
  predicate: (lifecycle: AgentThothLifecycle) => boolean,
  label: string,
  timeoutMs = FOREGROUND_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs;
  let last: Awaited<ReturnType<DaemonClient["getAgentThothState"]>> | null = null;
  while (Date.now() < deadline) {
    last = await runtime.client.getAgentThothState(agentId);
    if (last.error) throw new Error(last.error);
    if (predicate(last.state.lifecycle)) return last.state;
    await sleep(300);
  }
  throw new Error(`Timed out waiting for ${label}. Last state=${JSON.stringify(last?.state)}`);
}

async function waitForPendingCard(
  runtime: FlowRuntime,
  agentId: string,
  kind: "clarify_card" | "intent_contract_card",
  title: string,
): Promise<ThothClarifyCardModel | ThothIntentContractCardModel> {
  const deadline = Date.now() + FOREGROUND_TIMEOUT_MS;
  let last: unknown = null;
  while (Date.now() < deadline) {
    const payload = await runtime.client.getAgentThothState(agentId);
    if (payload.error) throw new Error(payload.error);
    last = payload.state;
    const pending = payload.state.pendingCard;
    const pendingTitle =
      pending?.kind === "clarify_card" ? pending.card.card.title : pending?.card.contract.title;
    if (pending?.kind === kind && pendingTitle === title && !pending.card.submitted) {
      return pending.card;
    }
    await sleep(300);
  }
  throw new Error(`Timed out waiting for ${kind} ${title}: ${JSON.stringify(last)}`);
}

let commandSequence = 0;
let approvalSequence = 0;

async function answerCard(input: {
  runtime: FlowRuntime;
  agentId: string;
  cardId: string;
  answer: ThothCardAnswerPayload;
}): Promise<void> {
  const current = await input.runtime.client.getAgentThothState(input.agentId);
  if (current.error) throw new Error(current.error);
  const result = await input.runtime.client.answerAgentThothCard({
    agentId: input.agentId,
    cardId: input.cardId,
    answer: input.answer,
    expectedRevision: current.state.revision,
    commandId: `real-flow-${++commandSequence}`,
  });
  if (result.error || result.conflict || !result.accepted) {
    throw new Error(result.error ?? "Agent-scoped Card answer was rejected");
  }
}

async function driveClarifyToIntentContract(input: {
  runtime: FlowRuntime;
  agentId: string;
  script: ThothRealProviderFlowScript;
  mode: "quick" | "loop";
}): Promise<ThothIntentContractCardModel> {
  for (const round of input.script.clarify) {
    const card = (await waitForPendingCard(
      input.runtime,
      input.agentId,
      "clarify_card",
      round.ask.title,
    )) as ThothClarifyCardModel;
    await answerCard({
      runtime: input.runtime,
      agentId: input.agentId,
      cardId: card.id,
      answer: {
        intent: "submit_choices",
        questionCardId: card.id,
        answers: card.card.questions.map((question) => ({
          nodeId: question.nodeId,
          choiceIds: [question.choices[0]!.id],
          choiceNotes: {},
        })),
        delegatedNodeIds: [],
        rawAnswer: "Use every first fixed option.",
      },
    });
  }
  if (!input.script.contract) throw new Error(`Script ${input.script.id} has no Intent Contract`);
  const contract = (await waitForPendingCard(
    input.runtime,
    input.agentId,
    "intent_contract_card",
    input.script.contract.contract.title,
  )) as ThothIntentContractCardModel;
  await answerCard({
    runtime: input.runtime,
    agentId: input.agentId,
    cardId: contract.id,
    answer: {
      intent: input.mode === "loop" ? "accept_loop" : "accept_quick",
      cardId: contract.id,
      rawAnswer: `Accept the fixed ${input.mode} Intent Contract.`,
    },
  });
  return contract;
}

async function timelineEntries(runtime: FlowRuntime, agentId: string) {
  return (
    await runtime.client.fetchAgentTimeline(agentId, {
      direction: "tail",
      limit: 0,
      projection: "canonical",
    })
  ).entries;
}

async function waitForAssistantMarker(
  runtime: FlowRuntime,
  agentId: string,
  marker: string,
): Promise<void> {
  const deadline = Date.now() + FOREGROUND_TIMEOUT_MS;
  let lastEntries: Awaited<ReturnType<typeof timelineEntries>> = [];
  while (Date.now() < deadline) {
    lastEntries = await timelineEntries(runtime, agentId);
    if (
      lastEntries.some(
        (entry) => entry.item.type === "assistant_message" && entry.item.text.includes(marker),
      )
    ) {
      return;
    }
    await sleep(300);
  }
  const lastAssistantMessages = lastEntries
    .flatMap((entry) => (entry.item.type === "assistant_message" ? [entry.item.text] : []))
    .slice(-5);
  throw new Error(
    `Timed out waiting for assistant marker ${marker}. Last assistant messages=${JSON.stringify(lastAssistantMessages)}`,
  );
}

function assertNoFixtureWorkProducts(runtime: FlowRuntime): void {
  expect(
    readdirSync(runtime.cwd).filter((entry) => !THOTH_RUNTIME_WORKSPACE_ENTRIES.has(entry)),
  ).toEqual([]);
}

async function waitForLoopTask(
  runtime: FlowRuntime,
  predicate: (task: TaskProjection) => boolean,
  label: string,
): Promise<{ task: TaskProjection; executions: ExecutionProjection[]; evidence: unknown[] }> {
  const deadline = Date.now() + LOOP_TIMEOUT_MS;
  let last: unknown = null;
  while (Date.now() < deadline) {
    const listed = await runtime.client.listTasks(runtime.workspaceId);
    if (listed.error) throw new Error(listed.error);
    const summary = listed.tasks[0];
    if (summary) {
      const detail = await runtime.client.getTask({
        taskId: summary.id,
        workspaceId: runtime.workspaceId,
      });
      if (detail.error) throw new Error(detail.error);
      last = detail;
      if (detail.executions.length > 8) {
        throw new Error(`Loop exceeded eight Executions: ${JSON.stringify(detail)}`);
      }
      for (const execution of detail.executions) {
        const approval = execution.pendingApproval;
        if (!approval) continue;
        const resolved = await runtime.client.resolveExecutionApproval({
          workspaceId: runtime.workspaceId,
          taskId: summary.id,
          executionId: execution.id,
          approvalId: approval.id,
          decision: approval.kind === "implement" ? "implement" : "allow",
          expectedRevision: approval.revision,
          commandId: `real-flow-approval-${++approvalSequence}`,
        });
        if (resolved.error && !resolved.conflict) throw new Error(resolved.error);
      }
      if (detail.task && predicate(detail.task)) {
        return { task: detail.task, executions: detail.executions, evidence: detail.evidence };
      }
      if (detail.task?.status === "interrupted") {
        throw new Error(`Loop interrupted before ${label}: ${JSON.stringify(detail)}`);
      }
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(last)}`);
}

async function assertLoopTransport(
  runtime: FlowRuntime,
  task: TaskProjection,
  executions: ExecutionProjection[],
): Promise<void> {
  const execute = executions.filter((execution) => execution.phase === "execute");
  const review = executions.filter((execution) => execution.phase === "review");
  expect(execute.length).toBeGreaterThan(0);
  expect(review.length).toBeGreaterThan(0);
  expect(
    [...execute, ...review].every((execution) => execution.attachment?.bundleId === "thoth.loop"),
  ).toBe(true);
  const timelines = await Promise.all(
    executions.map((execution) =>
      runtime.client.getExecutionTimeline({
        workspaceId: runtime.workspaceId,
        taskId: task.id,
        executionId: execution.id,
        limit: 500,
      }),
    ),
  );
  expect(timelines.every((payload) => !payload.error && payload.entries.length > 0)).toBe(true);
}

describe.sequential("Thoth public Agent journeys (real Codex dynamicTools)", () => {
  let canRun = false;
  const runtimes: FlowRuntime[] = [];

  beforeAll(async () => {
    canRun = await canRunNativeCodexProvider();
  });

  beforeEach((context) => {
    if (!canRun) context.skip();
  });

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
  });

  test(
    THOTH_REAL_PROVIDER_FLOW_SCRIPTS.quickDirect.id,
    async () => {
      const runtime = await createFlowRuntime();
      runtimes.push(runtime);
      const script = THOTH_REAL_PROVIDER_FLOW_SCRIPTS.quickDirect;
      const prompt = await configureFixture(runtime, script);
      const agent = await createFixtureAgent({ runtime, prompt, thoth: { enabled: false } });
      await waitForState(runtime, agent.id, (lifecycle) => lifecycle === "done", "raw completion");
      await waitForAssistantMarker(runtime, agent.id, script.finalMarker);
      expect((await runtime.client.listTasks(runtime.workspaceId)).tasks).toEqual([]);
      assertNoFixtureWorkProducts(runtime);
    },
    240_000,
  );

  test(
    THOTH_REAL_PROVIDER_FLOW_SCRIPTS.quickClarifyForeground.id,
    async () => {
      const runtime = await createFlowRuntime();
      runtimes.push(runtime);
      const direct = THOTH_REAL_PROVIDER_FLOW_SCRIPTS.quickDirect;
      const agent = await createFixtureAgent({
        runtime,
        prompt: await configureFixture(runtime, direct),
        thoth: { enabled: false },
      });
      await waitForState(runtime, agent.id, (lifecycle) => lifecycle === "done", "first raw turn");
      const before = await runtime.client.fetchAgent({ agentId: agent.id });
      const sessionId = before?.agent.runtimeInfo?.sessionId;

      const script = THOTH_REAL_PROVIDER_FLOW_SCRIPTS.quickClarifyForeground;
      const prompt = await configureFixture(runtime, script);
      await runtime.client.sendAgentMessage(agent.id, prompt, {
        thoth: { enabled: true, executionMode: "quick", clarifyStrength: "light" },
      });
      await driveClarifyToIntentContract({ runtime, agentId: agent.id, script, mode: "quick" });
      await waitForState(
        runtime,
        agent.id,
        (lifecycle) => lifecycle === "done",
        "Quick completion",
      );
      await waitForAssistantMarker(runtime, agent.id, script.finalMarker);

      const tasks = await runtime.client.listTasks(runtime.workspaceId);
      expect(tasks.tasks).toHaveLength(1);
      const quick = await runtime.client.getTask({
        workspaceId: runtime.workspaceId,
        taskId: tasks.tasks[0]!.id,
      });
      expect(quick.task).toMatchObject({
        mode: "quick",
        status: "completed",
        completionAuthority: "executor_unreviewed",
      });
      expect(quick.executions).toEqual([
        expect.objectContaining({
          phase: "quick_exec",
          status: "succeeded",
          attachment: expect.objectContaining({ bundleId: "thoth.clarify" }),
        }),
      ]);
      expect(quick.evidence).toHaveLength(1);

      await runtime.client.sendAgentMessage(agent.id, await configureFixture(runtime, direct), {
        thoth: { enabled: false },
      });
      await waitForState(runtime, agent.id, (lifecycle) => lifecycle === "done", "second raw turn");
      const after = await runtime.client.fetchAgent({ agentId: agent.id });
      expect(after?.agent.runtimeInfo?.sessionId).toBe(sessionId);
      assertNoFixtureWorkProducts(runtime);
    },
    420_000,
  );

  test(
    THOTH_REAL_PROVIDER_FLOW_SCRIPTS.loopLinearPass.id,
    async () => {
      const runtime = await createFlowRuntime();
      runtimes.push(runtime);
      const script = THOTH_REAL_PROVIDER_FLOW_SCRIPTS.loopLinearPass;
      const agent = await createFixtureAgent({
        runtime,
        prompt: await configureFixture(runtime, script),
        thoth: {
          enabled: true,
          executionMode: "loop",
          clarifyStrength: "light",
          loopStrength: "one_plan_one_do",
        },
      });
      await driveClarifyToIntentContract({ runtime, agentId: agent.id, script, mode: "loop" });
      await waitForState(
        runtime,
        agent.id,
        (lifecycle) => lifecycle === "background_handoff",
        "background handoff",
      );
      const completed = await waitForLoopTask(
        runtime,
        (task) => task.status === "completed",
        "target completion",
      );
      expect(completed.task).toMatchObject({
        status: "completed",
        latestReview: { decision: "complete" },
        budget: { maxNonCompleteReviews: 1, usedNonCompleteReviews: 0 },
      });
      expect(completed.task.workUnits).toHaveLength(1);
      expect(completed.evidence.length).toBeGreaterThan(0);
      await assertLoopTransport(runtime, completed.task, completed.executions);
      assertNoFixtureWorkProducts(runtime);
    },
    600_000,
  );

  test(
    THOTH_REAL_PROVIDER_FLOW_SCRIPTS.loopRetryAndBudget.id,
    async () => {
      const runtime = await createFlowRuntime();
      runtimes.push(runtime);
      const script = THOTH_REAL_PROVIDER_FLOW_SCRIPTS.loopRetryAndBudget;
      const agent = await createFixtureAgent({
        runtime,
        prompt: await configureFixture(runtime, script),
        thoth: {
          enabled: true,
          executionMode: "loop",
          clarifyStrength: "light",
          loopStrength: "light",
        },
      });
      await driveClarifyToIntentContract({ runtime, agentId: agent.id, script, mode: "loop" });
      const completed = await waitForLoopTask(
        runtime,
        (task) => task.status === "completed",
        "fresh Review reorientation",
      );
      expect(completed.task).toMatchObject({
        status: "completed",
        latestReview: { decision: "complete" },
        budget: { maxNonCompleteReviews: 5, usedNonCompleteReviews: 1 },
      });
      expect(completed.task.workUnits).toHaveLength(2);
      expect(completed.task.workingSet.rejectedRoutes.join("\n")).toContain("UT05_W1");
      expect(completed.executions.map((execution) => execution.phase)).toEqual([
        "execute",
        "review",
        "execute",
        "review",
      ]);
      await assertLoopTransport(runtime, completed.task, completed.executions);
      assertNoFixtureWorkProducts(runtime);
    },
    600_000,
  );
});
