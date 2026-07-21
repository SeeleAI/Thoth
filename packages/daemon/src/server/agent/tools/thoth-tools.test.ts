import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentManager, ManagedAgent } from "../agent-manager.js";
import type { AgentStreamEvent, AgentTimelineItem } from "@thoth/drivers/agent-runtime";
import type { AgentStorage } from "../agent-storage.js";
import type { ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import {
  rejectClarifyConvergenceAudit,
  resolveClarifyConvergenceAudit,
} from "../clarify-audit-broker.js";
import {
  beginForegroundTurnFence,
  bindForegroundProviderTurn,
  resetForegroundTurnFencesForTest,
} from "./foreground-turn-fence.js";
import { createThothToolCatalog } from "./thoth-tools.js";
import {
  WorkspaceAuthorityManager,
  WorkspaceForegroundAuthority,
  type TaskToolGateway,
} from "../../workspace-authority/index.js";
import type { ThothCardAnswerPayload } from "@thoth/protocol/thoth/rpc-schemas";

const temporaryHomes: string[] = [];
let currentAuthorityStore: WorkspaceForegroundAuthority | null = null;
const authorityManagers: WorkspaceAuthorityManager[] = [];
let commandSequence = 0;

async function flushToolStart(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function createCatalog(
  input: {
    auditOutcome?: "proceed" | "revise_frontier";
    auditFailure?: string;
    enableLoopRuntimeTools?: boolean;
    loopPhase?: "planexec" | "review";
    taskToolGateway?: TaskToolGateway;
    callerAvailableAfterCatalogCreation?: boolean;
    foregroundTurnKind?: "raw_provider" | "thoth_clarify";
  } = {},
) {
  const timeline: AgentTimelineItem[] = [];
  const appendTimelineItem = vi.fn(async (agentId: string, item: AgentTimelineItem) => {
    if (agentId === "agent-1") {
      timeline.push(item);
    }
  });
  const primaryAgent = {
    id: "agent-1",
    provider: "codex",
    cwd: "/tmp/thoth-tool-test",
    labels: { topicId: "topic-main", ...(input.loopPhase ? { loopPhase: input.loopPhase } : {}) },
    config: {
      provider: "codex",
      cwd: "/tmp/thoth-tool-test",
      extra: {
        thothRuntimeTools: {
          enabled: true,
          scope: input.enableLoopRuntimeTools
            ? input.loopPhase === "review"
              ? "loop_review"
              : "loop_planexec"
            : "clarify",
        },
      },
    },
  } as ManagedAgent;
  let callerRegistered = input.callerAvailableAfterCatalogCreation !== true;
  const agentManager = {
    appendTimelineItem,
    getAgent: (agentId: string) =>
      agentId === "agent-1" && callerRegistered ? primaryAgent : null,
    getTimeline: (agentId: string) => (agentId === "agent-1" ? [...timeline] : []),
    cancelAgentRun: vi.fn(async () => true),
    createAgent: vi.fn(async (config: Parameters<AgentManager["createAgent"]>[0]) => {
      const auditAgent = {
        id: "clarify-audit-agent",
        provider: "codex",
        cwd: config.cwd,
        config,
        labels: { surface: "thoth-clarify-audit" },
      } as ManagedAgent;
      setImmediate(() => {
        if (input.auditFailure) {
          rejectClarifyConvergenceAudit(auditAgent.id, input.auditFailure);
          return;
        }
        resolveClarifyConvergenceAudit(auditAgent.id, {
          outcome: input.auditOutcome ?? "proceed",
          summary:
            input.auditOutcome === "revise_frontier"
              ? "Performance acceptance remains a material user-owned boundary."
              : "The candidate Task Card is grounded by the submitted frontier ledger.",
          missing_material_frontier:
            input.auditOutcome === "revise_frontier" ? ["性能验收基线"] : [],
          rejected_question_patterns: [],
          task_memory_refs: [],
        });
      });
      return auditAgent;
    }),
    streamAgent: () =>
      (async function* pendingAuditStream(): AsyncGenerator<AgentStreamEvent> {
        await new Promise((resolve) => setImmediate(resolve));
      })(),
  } as unknown as AgentManager;

  const logger = createTestLogger();
  const thothHome = mkdtempSync(join(tmpdir(), "thoth-tools-authority-"));
  temporaryHomes.push(thothHome);
  const authorityManager = new WorkspaceAuthorityManager(thothHome);
  authorityManagers.push(authorityManager);
  authorityManager.catalog.upsertWorkspace({
    id: "workspace-test",
    canonicalPath: primaryAgent.cwd,
    displayName: "Test Workspace",
    kind: "workspace",
    parentWorkspaceId: null,
    archivedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const authorityStore = new WorkspaceForegroundAuthority(authorityManager);
  currentAuthorityStore = authorityStore;
  const turnKind = input.foregroundTurnKind ?? "thoth_clarify";
  const foreground = authorityStore.startTurn({
    agentId: "agent-1",
    kind: turnKind === "raw_provider" ? "raw" : "thoth",
    ...(turnKind === "thoth_clarify"
      ? { controls: { mode: "quick" as const, clarifyStrength: "light" as const, loop: null } }
      : {}),
    sourceMessageId: `message-${temporaryHomes.length}`,
    workspaceId: "workspace-test",
    workspacePath: primaryAgent.cwd,
    userText: "Test foreground turn",
  });
  const catalog = createThothToolCatalog({
    agentManager,
    agentStorage: {} as AgentStorage,
    terminalManager: null,
    providerSnapshotManager: {} as ProviderSnapshotManager,
    logger,
    workspaceAuthorityManager: authorityManager,
    callerAgentId: "agent-1",
    callerAgentConfig: primaryAgent.config,
    ...(input.taskToolGateway ? { taskToolGateway: input.taskToolGateway } : {}),
  });
  callerRegistered = true;
  beginForegroundTurnFence({
    agentId: "agent-1",
    generation: "test-generation",
    kind: turnKind,
    foregroundTurnId: foreground.turn.id,
  });
  bindForegroundProviderTurn({
    agentId: "agent-1",
    generation: "test-generation",
    providerTurnId: "turn-1",
  });
  return { appendTimelineItem, timeline, catalog };
}

function answerPendingRuntimeDecision(input: {
  cardId: string;
  submittedSummary: string;
  answer: ThothCardAnswerPayload;
}): void {
  const store = currentAuthorityStore;
  if (!store) {
    throw new Error("Test foreground authority store is unavailable");
  }
  const card = store.getCard(input.cardId);
  if (!card) {
    throw new Error(`Missing authority card ${input.cardId}`);
  }
  const state = store.getState(card.agentId);
  const result = store.answerCard({
    agentId: card.agentId,
    cardId: card.id,
    answer: input.answer,
    submittedCard: { ...card.card, submitted: true, submittedSummary: input.submittedSummary },
    submittedSummary: input.submittedSummary,
    expectedRevision: state.revision,
    commandId: `test-answer-${++commandSequence}`,
    nextLifecycle: "running",
    actorId: "user:test",
    clientId: "test-client",
  });
  expect(result.accepted).toBe(true);
}

function readyConvergenceReview() {
  return {
    frontier_ledger: {
      clarify_strength: "light",
      grounded_user_decisions: ["用户确认语言和交付形态。"],
      remaining_material_user_owned_assumptions: [],
      agent_owned_assumptions: ["实现细节由 agent 决定。"],
      discoverable_assumptions: ["测试命令从仓库发现。"],
      why_this_round: "已足够形成任务总览。",
      convergence_state: "ready_for_task",
    },
    why_task_is_now_grounded: "关键用户决策已经确认，剩余都是 agent 可决定或可发现事项。",
  };
}

async function submitApprovedTaskCard(
  catalog: ReturnType<typeof createCatalog>["catalog"],
): Promise<void> {
  const toolResult = catalog.executeTool(
    "thoth_submit_task_card",
    {
      task_card: {
        title: "已确认的测试任务",
        goal: "为 Goals Card transition guard 提供已确认的 Task Card。",
        constraints: ["仅验证 authority 顺序。"],
        acceptance: ["Goals Card 只能出现在 Task Card 批准后。"],
      },
      provenance: { clarify_transcript_verbatim: "固定的 Clarify 原文。" },
      convergence_review: readyConvergenceReview(),
    },
    {
      providerToolCall: {
        provider: "codex",
        threadId: "thread-1",
        turnId: "turn-1",
        callId: "call-approved-task",
        toolName: "thoth_submit_task_card",
      },
    },
  );
  await flushToolStart();
  const cardId = takeOnlyPendingCardId();
  answerPendingRuntimeDecision({
    cardId,
    submittedSummary: "已确认测试任务",
    answer: {
      intent: "accept_quick",
      card_id: cardId,
      title: "已确认的测试任务",
      raw_answer: "确认",
    },
  });
  await toolResult;
  const turn = currentAuthorityStore?.getActiveTurn("agent-1");
  if (!turn) throw new Error("Missing foreground turn after Task Card answer");
  beginForegroundTurnFence({
    agentId: "agent-1",
    generation: turn.generation,
    kind: "thoth_clarify",
    foregroundTurnId: turn.id,
  });
  bindForegroundProviderTurn({
    agentId: "agent-1",
    generation: turn.generation,
    providerTurnId: "turn-1",
  });
}

function takeOnlyPendingCardId(): string {
  const pending =
    currentAuthorityStore?.listAllCards().filter((card) => card.status === "pending") ?? [];
  expect(pending).toHaveLength(1);
  return pending[0]!.id;
}

async function submitAnsweredClarifyCard(
  catalog: ReturnType<typeof createCatalog>["catalog"],
  strength: "light" | "balanced" | "dive",
  input: { converged?: boolean } = {},
) {
  const converged = input.converged === true;
  const toolResult = catalog.executeTool(
    "thoth_submit_clarify_card",
    {
      title: "确认目标边界",
      why_now: "这些选择会改变实现路线和验收边界。",
      public_badge_summary: "正在拆解目标边界：确认路线、接口和验收的材料分支。",
      frontier_ledger: {
        clarify_strength: strength,
        grounded_user_decisions: [],
        remaining_material_user_owned_assumptions: converged
          ? []
          : ["实现路线", "接口形态", "验收边界"],
        agent_owned_assumptions: ["具体实现策略由 agent 决定。"],
        discoverable_assumptions: ["仓库测试命令可发现。"],
        why_this_round: converged
          ? "所有材料分支已收敛，可以进入任务总览。"
          : "这些答案决定任务合同边界。",
        convergence_state: converged ? "ready_for_task" : "not_converged",
      },
      questions: [
        {
          id: "route",
          question: "这次优先交付哪类结果？",
          choices: [
            { id: "library", label: "库函数", description: "最小复用接口" },
            { id: "cli", label: "命令行", description: "可传参运行" },
          ],
        },
        {
          id: "interface",
          question: "接口更偏向哪种使用方式？",
          choices: [
            { id: "simple", label: "简单调用", description: "默认路径清晰" },
            { id: "config", label: "可配置", description: "保留参数入口" },
          ],
        },
        {
          id: "acceptance",
          question: "验收更看重什么？",
          choices: [
            { id: "correctness", label: "正确性", description: "覆盖边界输入" },
            { id: "benchmark", label: "性能基准", description: "给出耗时对比" },
          ],
        },
      ],
    },
    {
      providerToolCall: {
        provider: "codex",
        threadId: "thread-1",
        turnId: "turn-1",
        callId: `call-clarify-${strength}`,
        toolName: "thoth_submit_clarify_card",
      },
    },
  );
  await flushToolStart();
  const cardId = takeOnlyPendingCardId();
  answerPendingRuntimeDecision({
    cardId,
    submittedSummary: "已确认 3 个材料分支",
    answer: {
      intent: "submit_choices",
      question_card_id: cardId,
      title: "确认目标边界",
      answers: [],
      raw_answer: "选择第一项",
    },
  });
  const result = await toolResult;
  const turn = currentAuthorityStore?.getActiveTurn("agent-1");
  if (!turn) throw new Error("Missing foreground turn after Clarify Card answer");
  beginForegroundTurnFence({
    agentId: "agent-1",
    generation: turn.generation,
    kind: "thoth_clarify",
    foregroundTurnId: turn.id,
  });
  bindForegroundProviderTurn({
    agentId: "agent-1",
    generation: turn.generation,
    providerTurnId: "turn-1",
  });
  return result;
}

afterEach(() => {
  resetForegroundTurnFencesForTest();
  currentAuthorityStore = null;
  for (const manager of authorityManagers.splice(0)) {
    manager.close();
  }
  for (const home of temporaryHomes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe("Thoth runtime authority tools", () => {
  it("rejects remembered authority tools during a raw provider turn", async () => {
    const { catalog, timeline } = createCatalog({ foregroundTurnKind: "raw_provider" });

    await expect(
      catalog.executeTool(
        "thoth_submit_clarify_card",
        {
          title: "This must not create a card",
          why_now: "The raw provider turn must remain raw.",
          public_badge_summary: "This call is intentionally rejected.",
          frontier_ledger: {
            clarify_strength: "light",
            grounded_user_decisions: [],
            remaining_material_user_owned_assumptions: ["A user decision"],
            agent_owned_assumptions: [],
            discoverable_assumptions: [],
            why_this_round: "Fence test.",
            convergence_state: "not_converged",
          },
          questions: [
            {
              id: "q1",
              question: "Should not be visible.",
              choices: [{ id: "a", label: "A", description: "Rejected before parsing authority." }],
            },
          ],
        },
        {
          providerToolCall: {
            provider: "codex",
            threadId: "thread-raw",
            turnId: "turn-raw",
            callId: "call-raw",
            toolName: "thoth_submit_clarify_card",
          },
        },
      ),
    ).rejects.toThrow("disabled for this raw provider turn");

    expect(currentAuthorityStore?.listAllCards()).toEqual([]);
    expect(timeline).toEqual([]);
  });

  it("registers Clarify tools from launch config before the caller agent is registered", () => {
    const agentManager = {
      appendTimelineItem: vi.fn(async () => undefined),
      getAgent: () => null,
    } as unknown as AgentManager;
    const catalog = createThothToolCatalog({
      agentManager,
      agentStorage: {} as AgentStorage,
      terminalManager: null,
      providerSnapshotManager: {} as ProviderSnapshotManager,
      logger: createTestLogger(),
      callerAgentId: "agent-launching",
      callerAgentConfig: {
        extra: { thothRuntimeTools: { enabled: true, scope: "clarify" } },
      },
    });

    expect(catalog.getTool("thoth_submit_clarify_card")).toBeDefined();
    expect(catalog.getTool("thoth_submit_task_card")).toBeDefined();
    expect(catalog.getTool("thoth_submit_goals_card")).toBeDefined();
    expect(catalog.getTool("thoth_report_blocked")).toBeDefined();
  });

  it("parks the provider after opening a Task Card", async () => {
    const { catalog } = createCatalog();
    const toolResult = catalog.executeTool(
      "thoth_submit_task_card",
      {
        task_card: {
          title: "实现高性能快速排序",
          goal: "实现一个可复用的高性能快速排序。",
          constraints: ["保持用户选择的语言和交付形态。"],
          acceptance: ["正确性测试通过。", "性能基准可运行。"],
        },
        provenance: {
          clarify_transcript_verbatim: "用户确认了语言、交付形态和验收边界。",
        },
        convergence_review: readyConvergenceReview(),
      },
      {
        providerToolCall: {
          provider: "codex",
          threadId: "thread-1",
          turnId: "turn-1",
          callId: "call-task",
          toolName: "thoth_submit_task_card",
        },
      },
    );
    await flushToolStart();

    const cardId = takeOnlyPendingCardId();
    expect(currentAuthorityStore?.getCard(cardId)?.card).toMatchObject({
      turnControls: { mode: "quick", clarifyStrength: "light", loop: null },
    });
    answerPendingRuntimeDecision({
      cardId,
      submittedSummary: "已确认并保持 Quick",
      answer: {
        intent: "accept_quick",
        card_id: cardId,
        title: "实现高性能快速排序",
        raw_answer: "确认按 Quick 前台执行",
      },
    });

    const result = await toolResult;
    expect(result.structuredContent).toMatchObject({ status: "awaiting_user", cardId });
    expect(result.content.map((item) => item.text ?? "").join("\n")).toContain(
      "Stop this turn and wait for the user's answer",
    );
  });

  it("resolves the live caller after catalog creation before starting a convergence audit", async () => {
    const { catalog } = createCatalog({ callerAvailableAfterCatalogCreation: true });
    const toolResult = catalog.executeTool(
      "thoth_submit_task_card",
      {
        task_card: {
          title: "延迟注册的测试任务",
          goal: "验证动态工具 catalog 创建后仍能启动独立 audit。",
          constraints: ["仅验证注册时序。"],
          acceptance: ["Task Card 正常进入用户确认。"],
        },
        provenance: { clarify_transcript_verbatim: "固定的 Clarify 原文。" },
        convergence_review: readyConvergenceReview(),
      },
      {
        providerToolCall: {
          provider: "codex",
          threadId: "thread-late-caller",
          turnId: "turn-1",
          callId: "call-late-caller",
          toolName: "thoth_submit_task_card",
        },
      },
    );

    await flushToolStart();
    const cardId = takeOnlyPendingCardId();
    answerPendingRuntimeDecision({
      cardId,
      submittedSummary: "已确认延迟注册测试任务",
      answer: {
        intent: "accept_quick",
        card_id: cardId,
        title: "延迟注册的测试任务",
        raw_answer: "确认",
      },
    });
    await expect(toolResult).resolves.toMatchObject({
      structuredContent: { status: "awaiting_user" },
    });
  });

  it("parks a converged Clarify Card without continuing provider prose", async () => {
    const { catalog } = createCatalog();
    const result = await submitAnsweredClarifyCard(catalog, "light", { converged: true });
    const text = result.content.map((item) => item.text ?? "").join("\n");

    expect(text).toContain("Stop this turn and wait for the user's answer");
  });

  it("requires an explicit convergence review when Task is submitted below a strength soft target", async () => {
    const { catalog } = createCatalog();
    await expect(
      catalog.executeTool(
        "thoth_submit_task_card",
        {
          task_card: {
            title: "实现高性能快速排序",
            goal: "实现一个可复用的高性能快速排序。",
            constraints: ["保持用户选择的语言和交付形态。"],
            acceptance: ["正确性测试通过。", "性能基准可运行。"],
          },
          provenance: {
            clarify_transcript_verbatim: "用户确认了部分边界。",
          },
          convergence_review: {
            frontier_ledger: {
              clarify_strength: "dive",
              grounded_user_decisions: ["用户确认 C++。"],
              remaining_material_user_owned_assumptions: [],
              agent_owned_assumptions: ["pivot 策略由 agent 决定。"],
              discoverable_assumptions: ["测试命令可发现。"],
              why_this_round: "模型认为已可收敛。",
              convergence_state: "ready_for_task",
            },
            why_task_is_now_grounded: "模型认为剩余事项都不是用户材料决策。",
          },
        },
        {
          providerToolCall: {
            provider: "codex",
            threadId: "thread-1",
            turnId: "turn-1",
            callId: "call-task-low-target",
            toolName: "thoth_submit_task_card",
          },
        },
      ),
    ).rejects.toThrow("Clarify soft target not reviewed");
  });

  it("returns the independent audit frontier to the same Clarify session without opening a Task card", async () => {
    const { catalog } = createCatalog({ auditOutcome: "revise_frontier" });
    const result = await catalog.executeTool(
      "thoth_submit_task_card",
      {
        task_card: {
          title: "实现排序库",
          goal: "交付可复用排序能力。",
          constraints: ["保持 API 简洁。"],
          acceptance: ["正确性测试通过。"],
        },
        provenance: { clarify_transcript_verbatim: "用户确认了语言和交付形态。" },
        convergence_review: readyConvergenceReview(),
      },
      {
        providerToolCall: {
          provider: "codex",
          threadId: "thread-1",
          turnId: "turn-1",
          callId: "call-task-revise",
          toolName: "thoth_submit_task_card",
        },
      },
    );

    expect(
      currentAuthorityStore?.listAllCards().filter((card) => card.status === "pending"),
    ).toHaveLength(0);
    expect(result.structuredContent).toMatchObject({ status: "revise_frontier" });
    expect(result.content.map((item) => item.text).join("\n")).toContain("性能验收基线");
  });

  it("keeps the flow honestly blocked when the independent convergence audit cannot return", async () => {
    const { catalog } = createCatalog({ auditFailure: "Audit provider session timed out." });
    const result = await catalog.executeTool(
      "thoth_submit_task_card",
      {
        task_card: {
          title: "实现排序库",
          goal: "交付可复用排序能力。",
          constraints: ["保持 API 简洁。"],
          acceptance: ["正确性测试通过。"],
        },
        provenance: { clarify_transcript_verbatim: "用户确认了语言和交付形态。" },
        convergence_review: readyConvergenceReview(),
      },
      {
        providerToolCall: {
          provider: "codex",
          threadId: "thread-1",
          turnId: "turn-1",
          callId: "call-task-audit-failure",
          toolName: "thoth_submit_task_card",
        },
      },
    );

    expect(result.structuredContent).toMatchObject({ status: "blocked" });
    expect(result.isError).toBe(true);
    expect(result.content.map((item) => item.text).join("\n")).toContain(
      "Task Card was not created",
    );
    expect(
      currentAuthorityStore?.listAllCards().filter((card) => card.status === "pending"),
    ).toHaveLength(0);
  });

  it("rejects Task convergence reviews that downgrade the latest Clarify strength", async () => {
    const { catalog } = createCatalog();
    await submitAnsweredClarifyCard(catalog, "dive");

    await expect(
      catalog.executeTool(
        "thoth_submit_task_card",
        {
          task_card: {
            title: "实现高性能快速排序",
            goal: "实现一个可复用的高性能快速排序。",
            constraints: ["保持用户选择的语言和交付形态。"],
            acceptance: ["正确性测试通过。", "性能基准可运行。"],
          },
          provenance: {
            clarify_transcript_verbatim: "用户确认了部分边界。",
          },
          convergence_review: {
            frontier_ledger: {
              clarify_strength: "light",
              grounded_user_decisions: ["用户确认 C++。"],
              remaining_material_user_owned_assumptions: [],
              agent_owned_assumptions: ["pivot 策略由 agent 决定。"],
              discoverable_assumptions: ["测试命令可发现。"],
              why_this_round: "模型试图以 light 强度收敛。",
              convergence_state: "ready_for_task",
            },
            why_task_is_now_grounded: "模型认为剩余事项都不是用户材料决策。",
          },
        },
        {
          providerToolCall: {
            provider: "codex",
            threadId: "thread-1",
            turnId: "turn-1",
            callId: "call-task-strength-mismatch",
            toolName: "thoth_submit_task_card",
          },
        },
      ),
    ).rejects.toThrow("Clarify convergence review strength mismatch");
  });

  it("parks the provider after opening a Goals Card", async () => {
    const { catalog } = createCatalog();
    await submitApprovedTaskCard(catalog);
    const toolResult = catalog.executeTool(
      "thoth_submit_goals_card",
      {
        goals_card: {
          title: "高性能快速排序",
          summary: "按线性目标完成实现、验证和基准。",
          goals_count_rationale: "这是单元测试级小任务，单个目标已经足够细粒度、线性且可 review。",
          goals: [
            {
              id: "goal-1",
              order: 1,
              title: "排序能力",
              goal: "提供可复用排序能力。",
              constraints: ["保持接口清晰。"],
              acceptance: ["排序结果正确。"],
            },
          ],
        },
        provenance: {
          clarify_transcript_verbatim: "完整 Clarify 原文。",
          approved_ceo_task_card_verbatim: "已确认 Task Card 原文。",
        },
      },
      {
        providerToolCall: {
          provider: "codex",
          threadId: "thread-1",
          turnId: "turn-1",
          callId: "call-goals",
          toolName: "thoth_submit_goals_card",
        },
      },
    );
    await flushToolStart();

    const cardId = takeOnlyPendingCardId();
    answerPendingRuntimeDecision({
      cardId,
      submittedSummary: "已确认并按 Quick 前台执行",
      answer: {
        intent: "accept_quick",
        card_id: cardId,
        title: "高性能快速排序",
        raw_answer: "确认按 Quick 前台执行",
      },
    });

    const result = await toolResult;
    expect(result.structuredContent).toMatchObject({ status: "awaiting_user", cardId });
    expect(result.content.map((item) => item.text ?? "").join("\n")).toContain(
      "Stop this turn and wait for the user's answer",
    );
  });

  it("rejects a Goals Card before the user has approved a Task Card", async () => {
    const { catalog, appendTimelineItem } = createCatalog();
    const result = await catalog.executeTool(
      "thoth_submit_goals_card",
      {
        goals_card: {
          title: "不应跳过 Task 的 Goals",
          summary: "验证不合法 authority 跳转会被拒绝。",
          goals_count_rationale: "这是 transition guard 单元测试。",
          goals: [
            {
              id: "goal-1",
              order: 1,
              title: "唯一检查点",
              goal: "验证 transition guard。",
              constraints: ["没有 Task Card。"],
              acceptance: ["Goals Card 被拒绝。"],
            },
          ],
        },
        provenance: {
          clarify_transcript_verbatim: "固定的 Clarify 原文。",
          approved_ceo_task_card_verbatim: "不存在的 Task Card。",
        },
      },
      {
        providerToolCall: {
          provider: "codex",
          threadId: "thread-1",
          turnId: "turn-1",
          callId: "call-goals-without-task",
          toolName: "thoth_submit_goals_card",
        },
      },
    );

    expect(result).toMatchObject({
      isError: true,
      structuredContent: { ok: false, status: "rejected" },
    });
    expect(result.content.map((item) => item.text).join("\n")).toContain(
      "no user-approved Task Card",
    );
    expect(
      currentAuthorityStore?.listAllCards().filter((card) => card.status === "pending"),
    ).toHaveLength(0);
    expect(appendTimelineItem).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({ type: "tool_call", status: "failed", name: "goals_approval" }),
    );
  });

  it("uses public_badge_summary for Clarify timeline badges instead of legacy decision text", async () => {
    const { catalog, appendTimelineItem } = createCatalog();
    const toolResult = catalog.executeTool(
      "thoth_submit_clarify_card",
      {
        title: "确认排序目标边界",
        why_now: "这些选择会改变接口、性能基线和验收方式。",
        decision_it_changes: "legacy internal generic decision text",
        public_badge_summary: "正在拆解排序需求：先确认语言、交付形态和性能验收的材料分支。",
        frontier_ledger: {
          clarify_strength: "dive",
          grounded_user_decisions: [],
          remaining_material_user_owned_assumptions: ["语言", "交付形态", "性能基线"],
          agent_owned_assumptions: ["具体 pivot 策略后续由 agent 决定。"],
          discoverable_assumptions: ["仓库测试框架可由 agent 发现。"],
          why_this_round: "这些答案决定后续实现路线和验收边界。",
          convergence_state: "not_converged",
        },
        questions: [
          {
            id: "language",
            question: "用什么语言实现？",
            choices: [
              { id: "cpp", label: "C++", description: "贴近系统性能" },
              { id: "rust", label: "Rust", description: "安全且高性能" },
            ],
          },
          {
            id: "shape",
            question: "最终交付成什么形态？",
            choices: [
              { id: "library", label: "库函数", description: "最小复用接口" },
              { id: "cli", label: "命令行", description: "可传参运行" },
            ],
          },
          {
            id: "baseline",
            question: "性能用什么方式验收？",
            choices: [
              { id: "bench", label: "跑基准", description: "给出耗时对比" },
              { id: "tests", label: "测正确性", description: "正确性优先" },
            ],
          },
        ],
      },
      {
        providerToolCall: {
          provider: "codex",
          threadId: "thread-1",
          turnId: "turn-1",
          callId: "call-clarify",
          toolName: "thoth_submit_clarify_card",
        },
      },
    );
    await flushToolStart();

    const runningToolCall = appendTimelineItem.mock.calls.find(
      ([, item]) => item.type === "tool_call" && item.callId === "call-clarify",
    )?.[1];
    expect(runningToolCall).toMatchObject({
      detail: {
        label: "需求拆解",
        text: "正在拆解排序需求：先确认语言、交付形态和性能验收的材料分支。",
      },
      metadata: {
        pendingAuthorityDecision: true,
        roundIndex: 1,
      },
    });
    expect(JSON.stringify(runningToolCall)).not.toContain("legacy internal generic decision text");

    const cardId = takeOnlyPendingCardId();
    answerPendingRuntimeDecision({
      cardId,
      submittedSummary: "已确认 3 个分支维度",
      answer: {
        intent: "submit_choices",
        question_card_id: cardId,
        title: "确认排序目标边界",
        answers: [],
        raw_answer: "选择第一项",
      },
    });
    await toolResult;
  });

  it("seals provider dynamic-tool call ids into Loop phase results instead of trusting model-supplied ids", async () => {
    const resolvePlanExecResult = vi.fn(() => true);
    const resolveReviewVerdict = vi.fn(() => true);
    const { catalog: planExecCatalog } = createCatalog({
      enableLoopRuntimeTools: true,
      loopPhase: "planexec",
      taskToolGateway: {
        submitPlanExec: resolvePlanExecResult,
        submitReviewVerdict: resolveReviewVerdict,
      } as unknown as TaskToolGateway,
    });
    const { catalog: reviewCatalog } = createCatalog({
      enableLoopRuntimeTools: true,
      loopPhase: "review",
      taskToolGateway: {
        submitPlanExec: resolvePlanExecResult,
        submitReviewVerdict: resolveReviewVerdict,
      } as unknown as TaskToolGateway,
    });
    const context = {
      providerToolCall: {
        provider: "codex",
        threadId: "thread-loop",
        turnId: "turn-loop",
        callId: "provider-tool-call-1",
        toolName: "thoth_loop_submit_planexec_result",
      },
    };

    await planExecCatalog.executeTool(
      "thoth_loop_submit_planexec_result",
      {
        plan_summary: "Execute the current goal only.",
        execution_summary: "Completed the current goal.",
        evidence: ["Focused check passed."],
        next_review_focus: "Verify the focused check.",
      },
      context,
    );
    await reviewCatalog.executeTool(
      "thoth_loop_submit_review_verdict",
      {
        outcome: "pass",
        summary: "Current goal is accepted.",
        evidence_summary: "Focused check produced the expected proof.",
      },
      {
        providerToolCall: {
          ...context.providerToolCall,
          callId: "provider-tool-call-2",
          toolName: "thoth_loop_submit_review_verdict",
        },
      },
    );

    expect(resolvePlanExecResult).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({ plan_summary: "Execute the current goal only." }),
      "turn-loop",
      "provider-tool-call-1",
    );
    expect(resolveReviewVerdict).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({ outcome: "pass" }),
      "turn-loop",
      "provider-tool-call-2",
    );
  });

  it("registers only the semantic result tool for the active Loop phase", () => {
    const { catalog: planExecCatalog } = createCatalog({
      enableLoopRuntimeTools: true,
      loopPhase: "planexec",
    });
    const { catalog: reviewCatalog } = createCatalog({
      enableLoopRuntimeTools: true,
      loopPhase: "review",
    });

    expect(planExecCatalog.getTool("thoth_loop_submit_planexec_result")).toBeDefined();
    expect(planExecCatalog.getTool("thoth_loop_submit_review_verdict")).toBeUndefined();
    expect(planExecCatalog.getTool("thoth_loop_report_blocked")).toBeDefined();
    expect(reviewCatalog.getTool("thoth_loop_submit_planexec_result")).toBeUndefined();
    expect(reviewCatalog.getTool("thoth_loop_submit_review_independent_assessment")).toBeDefined();
    expect(reviewCatalog.getTool("thoth_loop_submit_review_verdict")).toBeDefined();
    expect(reviewCatalog.getTool("thoth_loop_report_blocked")).toBeDefined();
  });
});
