import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

import type {
  AgentThothLifecycle,
  ThothCardAnswerPayload,
  ThothClarifyCardModel,
  ThothGoalsCardModel,
  ThothTaskCardModel,
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
  if (!traceFile) {
    return pino({ level: "silent" });
  }
  return pino({ level: "trace" }, pino.destination({ dest: traceFile, sync: false }));
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
        "When the user supplies a THOTH REAL FLOW FIXTURE script, follow its literal calls and text exactly.",
        "Do not independently inspect or alter the workspace.",
      ].join(" "),
    });
    if (configured.error) throw new Error(configured.error);
    const created = await client.createWorkspace({ source: { kind: "directory", path: cwd } });
    if (created.error || !created.workspace) {
      throw new Error(
        `Failed to create temporary flow workspace: ${created.error ?? "unknown error"}`,
      );
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
  startAtClarifyIndex = 0,
): Promise<string> {
  const fixturePrompt = buildRealProviderFixturePrompt({ script, startAtClarifyIndex });
  const configured = await runtime.client.patchDaemonConfig({
    appendSystemPrompt: [
      "You are participating in an automated Thoth transport verification.",
      "The fixture actor instructions below are literal and apply only to visible Clarify, internal PlanExec, and independent Review sessions whose required runtime tool appears in that script.",
      "Do not inspect or alter the workspace. Do not replace prescribed dynamic-tool arguments with your own wording.",
      "A dedicated Clarify convergence audit follows its own audit system prompt and required audit tool.",
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
  const provider = getNativeCodexProviderConfig();
  return await input.runtime.client.createAgent({
    ...provider,
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
  throw new Error(
    `Timed out waiting for ${label}. Last state=${JSON.stringify(last?.state ?? null)}`,
  );
}

async function waitForPendingCard<T extends "clarify_card" | "task_card" | "goal_card">(
  runtime: FlowRuntime,
  agentId: string,
  kind: T,
  title: string,
): Promise<
  T extends "clarify_card"
    ? ThothClarifyCardModel
    : T extends "task_card"
      ? ThothTaskCardModel
      : ThothGoalsCardModel
> {
  const deadline = Date.now() + FOREGROUND_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const payload = await runtime.client.getAgentThothState(agentId);
    if (payload.error) throw new Error(payload.error);
    const pending = payload.state.pendingCard;
    if (
      pending?.kind === kind &&
      pending.card.title === title &&
      pending.card.submitted === false
    ) {
      return pending.card as never;
    }
    await sleep(300);
  }
  throw new Error(`Timed out waiting for ${kind} ${title}`);
}

let commandSequence = 0;

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

async function submitFixedClarifyAnswer(
  runtime: FlowRuntime,
  agentId: string,
  card: ThothClarifyCardModel,
): Promise<void> {
  if (!("questions" in card.card)) {
    throw new Error("The real fixture expected a multi-question Clarify Card");
  }
  await answerCard({
    runtime,
    agentId,
    cardId: card.id,
    answer: {
      intent: "submit_choices",
      question_card_id: card.id,
      title: card.title,
      answers: card.card.questions.map((question) => ({
        question_id: question.id,
        choice_ids: [question.choices[0]!.id],
        choice_notes: {},
      })),
      raw_answer: "Use every first fixed option.",
    },
  });
}

async function acceptApprovalCard(input: {
  runtime: FlowRuntime;
  agentId: string;
  card: ThothTaskCardModel | ThothGoalsCardModel;
  intent: "accept_quick" | "accept_loop";
}): Promise<void> {
  await answerCard({
    runtime: input.runtime,
    agentId: input.agentId,
    cardId: input.card.id,
    answer: {
      intent: input.intent,
      card_id: input.card.id,
      title: input.card.title,
      raw_answer:
        input.intent === "accept_loop"
          ? "Accept the fixed background flow."
          : "Accept the fixed foreground flow.",
    },
  });
}

async function driveToGoals(input: {
  runtime: FlowRuntime;
  agentId: string;
  script: ThothRealProviderFlowScript;
  startAtClarifyIndex?: number;
}): Promise<ThothGoalsCardModel> {
  const startAt = input.startAtClarifyIndex ?? 0;
  for (const payload of input.script.clarify.slice(startAt)) {
    const card = await waitForPendingCard(
      input.runtime,
      input.agentId,
      "clarify_card",
      payload.title,
    );
    await submitFixedClarifyAnswer(input.runtime, input.agentId, card);
  }
  if (!input.script.task || !input.script.goals) {
    throw new Error(`Script ${input.script.id} does not define approval Cards`);
  }
  const task = await waitForPendingCard(
    input.runtime,
    input.agentId,
    "task_card",
    input.script.task.task_card.title,
  );
  await acceptApprovalCard({
    runtime: input.runtime,
    agentId: input.agentId,
    card: task,
    intent: input.script.planExec.length > 0 ? "accept_loop" : "accept_quick",
  });
  return await waitForPendingCard(
    input.runtime,
    input.agentId,
    "goal_card",
    input.script.goals.goals_card.title,
  );
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
  while (Date.now() < deadline) {
    const entries = await timelineEntries(runtime, agentId);
    if (
      entries.some(
        (entry) => entry.item.type === "assistant_message" && entry.item.text.includes(marker),
      )
    ) {
      return;
    }
    await sleep(300);
  }
  throw new Error(`Timed out waiting for assistant marker ${marker}`);
}

async function visibleToolNames(runtime: FlowRuntime, agentId: string): Promise<string[]> {
  return (await timelineEntries(runtime, agentId)).flatMap((entry) =>
    entry.item.type === "tool_call" ? [entry.item.name] : [],
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
): Promise<{ task: TaskProjection; executions: ExecutionProjection[] }> {
  const deadline = Date.now() + LOOP_TIMEOUT_MS;
  let last: TaskProjection | null = null;
  while (Date.now() < deadline) {
    const listed = await runtime.client.listTasks(runtime.workspaceId);
    if (listed.error) throw new Error(listed.error);
    const summary = listed.tasks[0];
    if (summary) {
      const inspected = await runtime.client.getTask({
        taskId: summary.id,
        workspaceId: runtime.workspaceId,
      });
      if (inspected.error) throw new Error(inspected.error);
      last = inspected.task;
      if (last && predicate(last)) return { task: last, executions: inspected.executions };
    }
    await sleep(750);
  }
  throw new Error(`Timed out waiting for ${label}. Last task=${JSON.stringify(last)}`);
}

async function assertLoopPhaseTransport(
  runtime: FlowRuntime,
  task: TaskProjection,
  executions: ExecutionProjection[],
): Promise<void> {
  const planExec = executions.filter((execution) => execution.phase === "planexec");
  const review = executions.filter((execution) => execution.phase === "review");
  expect(planExec.length).toBeGreaterThan(0);
  expect(review.length).toBeGreaterThan(0);
  expect(
    [...planExec, ...review].every((execution) => execution.attachment?.bundleId === "thoth.loop"),
  ).toBe(true);
  const phaseTimelines = await Promise.all(
    executions.map(async (execution) =>
      runtime.client.getExecutionTimeline({
        workspaceId: runtime.workspaceId,
        taskId: task.id,
        executionId: execution.id,
        limit: 500,
      }),
    ),
  );
  expect(phaseTimelines.every((payload) => !payload.error && payload.entries.length > 0)).toBe(
    true,
  );
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
      const agent = await createFixtureAgent({
        runtime,
        prompt,
        thoth: { enabled: false },
      });
      await waitForState(runtime, agent.id, (lifecycle) => lifecycle === "done", "raw completion");
      await waitForAssistantMarker(runtime, agent.id, script.finalMarker);
      expect(
        (await visibleToolNames(runtime, agent.id)).filter((name) => name.startsWith("thoth_")),
      ).toEqual([]);
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
      const directPrompt = await configureFixture(runtime, direct);
      const agent = await createFixtureAgent({
        runtime,
        prompt: directPrompt,
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
      const goals = await driveToGoals({ runtime, agentId: agent.id, script });
      await acceptApprovalCard({
        runtime,
        agentId: agent.id,
        card: goals,
        intent: "accept_quick",
      });
      await waitForState(
        runtime,
        agent.id,
        (lifecycle) => lifecycle === "done",
        "Quick completion",
      );
      await waitForAssistantMarker(runtime, agent.id, script.finalMarker);

      await runtime.client.sendAgentMessage(agent.id, directPrompt, { thoth: { enabled: false } });
      await waitForState(runtime, agent.id, (lifecycle) => lifecycle === "done", "second raw turn");
      const after = await runtime.client.fetchAgent({ agentId: agent.id });
      expect(after?.agent.runtimeInfo?.sessionId).toBe(sessionId);
      expect(await visibleToolNames(runtime, agent.id)).toEqual(
        expect.arrayContaining(["clarify", "task_approval", "goals_approval"]),
      );
      const tasks = await runtime.client.listTasks(runtime.workspaceId);
      expect(tasks.tasks).toEqual([]);
      assertNoFixtureWorkProducts(runtime);
    },
    420_000,
  );

  test(
    THOTH_REAL_PROVIDER_FLOW_SCRIPTS.quickClarifyRecovery.id,
    async () => {
      const runtime = await createFlowRuntime();
      runtimes.push(runtime);
      const script = THOTH_REAL_PROVIDER_FLOW_SCRIPTS.quickClarifyRecovery;
      const prompt = await configureFixture(runtime, script);
      const agent = await createFixtureAgent({
        runtime,
        prompt,
        thoth: { enabled: true, executionMode: "quick", clarifyStrength: "light" },
      });
      const first = await waitForPendingCard(
        runtime,
        agent.id,
        "clarify_card",
        script.clarify[0].title,
      );
      expect((await runtime.client.getAgentThothState(agent.id)).state.pendingCard?.card.id).toBe(
        first.id,
      );
      await runtime.client.cancelAgent(agent.id);
      await waitForState(runtime, agent.id, (lifecycle) => lifecycle === "canceled", "cancel");

      const resumePrompt = await configureFixture(runtime, script, 1);
      await runtime.client.sendAgentMessage(agent.id, resumePrompt, {
        thoth: { enabled: true, executionMode: "quick", clarifyStrength: "light" },
      });
      const goals = await driveToGoals({
        runtime,
        agentId: agent.id,
        script,
        startAtClarifyIndex: 1,
      });
      await acceptApprovalCard({
        runtime,
        agentId: agent.id,
        card: goals,
        intent: "accept_quick",
      });
      await waitForState(runtime, agent.id, (lifecycle) => lifecycle === "done", "resumed Quick");
      await waitForAssistantMarker(runtime, agent.id, script.finalMarker);
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
      const prompt = await configureFixture(runtime, script);
      const agent = await createFixtureAgent({
        runtime,
        prompt,
        thoth: {
          enabled: true,
          executionMode: "loop",
          clarifyStrength: "light",
          loopStrength: "one_plan_one_do",
        },
      });
      const goals = await driveToGoals({ runtime, agentId: agent.id, script });
      await acceptApprovalCard({
        runtime,
        agentId: agent.id,
        card: goals,
        intent: "accept_loop",
      });
      await waitForState(
        runtime,
        agent.id,
        (lifecycle) => lifecycle === "background_handoff",
        "background handoff",
      );
      const completed = await waitForLoopTask(
        runtime,
        (task) => task.status === "completed",
        "two linear goals",
      );
      expect(completed.task.budget).toMatchObject({ maxFailedReviews: 1, usedFailedReviews: 0 });
      expect(completed.task.goals.map((goal) => goal.status)).toEqual(["passed", "passed"]);
      const context = await runtime.client.getTaskContext({
        workspaceId: runtime.workspaceId,
        taskId: completed.task.id,
      });
      expect(JSON.stringify(context.context?.blackboard)).toContain("UT04_G1_R1");
      expect(JSON.stringify(context.context?.blackboard)).toContain("UT04_G2_R1");
      await assertLoopPhaseTransport(runtime, completed.task, completed.executions);
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
      const prompt = await configureFixture(runtime, script);
      const agent = await createFixtureAgent({
        runtime,
        prompt,
        thoth: {
          enabled: true,
          executionMode: "loop",
          clarifyStrength: "light",
          loopStrength: "light",
        },
      });
      const goals = await driveToGoals({ runtime, agentId: agent.id, script });
      await acceptApprovalCard({
        runtime,
        agentId: agent.id,
        card: goals,
        intent: "accept_loop",
      });
      const completed = await waitForLoopTask(
        runtime,
        (task) => task.status === "completed",
        "failed Review retry completion",
      );
      expect(completed.task.budget).toMatchObject({ maxFailedReviews: 5, usedFailedReviews: 1 });
      expect(completed.task.goals.map((goal) => goal.status)).toEqual(["passed", "passed"]);
      expect(
        completed.executions.filter(
          (execution) =>
            execution.goalId === completed.task.goals[0]?.id && execution.phase === "planexec",
        ),
      ).toHaveLength(2);
      const context = await runtime.client.getTaskContext({
        workspaceId: runtime.workspaceId,
        taskId: completed.task.id,
      });
      expect(JSON.stringify(context.context?.blackboard)).toContain("UT05_G1_R2");
      expect(JSON.stringify(context.context?.blackboard)).toContain("UT05_G2_R1");
      await assertLoopPhaseTransport(runtime, completed.task, completed.executions);
      assertNoFixtureWorkProducts(runtime);
    },
    600_000,
  );
});
