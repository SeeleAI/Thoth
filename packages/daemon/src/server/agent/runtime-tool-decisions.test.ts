import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ThothCardAnswerPayload,
  ThothClarifyCardModel,
} from "@thoth/protocol/thoth/rpc-schemas";
import { createTestLogger } from "../../test-utils/test-logger.js";
import {
  WorkspaceAuthorityManager,
  WorkspaceForegroundAuthority,
} from "../workspace-authority/index.js";
import {
  createRuntimeAuthorityDecision,
  listRuntimeAuthorityDecisionRecords,
} from "./runtime-tool-decisions.js";

const temporaryHomes: string[] = [];

function clarifyCard(): ThothClarifyCardModel {
  return {
    id: "clarify-card-persist",
    roundLabel: "Clarify",
    title: "确认目标边界",
    whyNow: "这些选择会改变任务路线。",
    continuesClarify: true,
    publicBadgeSummary: "正在拆解目标边界。",
    frontierLedger: {
      clarify_strength: "dive",
      grounded_user_decisions: [],
      remaining_material_user_owned_assumptions: ["语言", "交付形态"],
      agent_owned_assumptions: ["具体实现策略由 agent 决定。"],
      discoverable_assumptions: ["测试命令可发现。"],
      why_this_round: "这些问题决定任务路线。",
      convergence_state: "not_converged",
    },
    submitted: false,
    card: {
      question_id: "question-card-persist",
      title: "确认目标边界",
      behavior_tree_node: "boundary",
      why_now: "先确认用户拥有的关键选择。",
      allow_choice_notes: true,
      allow_note_only: true,
      questions: [
        {
          id: "language",
          question: "用什么语言实现？",
          behavior_tree_node: "language",
          selection_mode: "single",
          choices: [
            { id: "cpp", label: "C++", description: "贴近系统性能" },
            { id: "rust", label: "Rust", description: "安全且高性能" },
          ],
        },
        {
          id: "shape",
          question: "交付成什么形态？",
          behavior_tree_node: "shape",
          selection_mode: "single",
          choices: [
            { id: "library", label: "库函数", description: "最小复用接口" },
            { id: "cli", label: "命令行", description: "可传参运行" },
          ],
        },
      ],
    },
  };
}

function createStore(home?: string): {
  home: string;
  store: WorkspaceForegroundAuthority;
  manager: WorkspaceAuthorityManager;
} {
  const resolvedHome = home ?? mkdtempSync(join(tmpdir(), "thoth-runtime-decisions-"));
  if (!home) {
    temporaryHomes.push(resolvedHome);
  }
  const manager = new WorkspaceAuthorityManager(resolvedHome);
  manager.catalog.upsertWorkspace({
    id: "workspace-test",
    canonicalPath: "/workspace/thoth",
    displayName: "Test Workspace",
    kind: "workspace",
    parentWorkspaceId: null,
    archivedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return { home: resolvedHome, store: new WorkspaceForegroundAuthority(manager), manager };
}

function startThothTurn(store: WorkspaceForegroundAuthority): void {
  store.startTurn({
    agentId: "agent-1",
    kind: "thoth",
    controls: { mode: "quick", clarifyStrength: "dive", loop: null },
    sourceMessageId: "message-1",
    workspaceId: "workspace-test",
    workspacePath: "/workspace/thoth",
    userText: "实现一个高性能工具",
  });
}

function createDecision(store: WorkspaceForegroundAuthority) {
  return createRuntimeAuthorityDecision({
    store,
    provider: "codex",
    agentId: "agent-1",
    threadId: "thread-1",
    providerTurnId: "turn-1",
    callId: "call-1",
    toolName: "thoth_submit_clarify_card",
    card: { kind: "clarify_card", card: clarifyCard() },
    redactedRawInputHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
}

afterEach(() => {
  for (const home of temporaryHomes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
  vi.useRealTimers();
});

describe("runtime authority decision persistence", () => {
  it("keeps an open Card actionable after process memory is lost", () => {
    const { home, store, manager } = createStore();
    startThothTurn(store);
    const { record } = createDecision(store);
    manager.close();

    const recoveredRuntime = createStore(home);
    const recovered = recoveredRuntime.store;
    try {
      expect(listRuntimeAuthorityDecisionRecords(recovered)).toContainEqual(
        expect.objectContaining({
          cardId: record.cardId,
          status: "pending",
          foregroundTurnId: record.foregroundTurnId,
        }),
      );
      expect(recovered.getState("agent-1")).toMatchObject({
        lifecycle: "awaiting_card",
        pendingCard: { card: { id: record.cardId } },
      });

      const answer: ThothCardAnswerPayload = {
        intent: "submit_choices",
        question_card_id: record.cardId,
        title: "确认目标边界",
        answers: [],
        raw_answer: "继续",
      };
      const state = recovered.getState("agent-1");
      const result = recovered.answerCard({
        agentId: "agent-1",
        cardId: record.cardId,
        answer,
        submittedCard: { ...clarifyCard(), submitted: true, submittedSummary: "继续" },
        submittedSummary: "继续",
        expectedRevision: state.revision,
        commandId: "answer-after-restart",
        nextLifecycle: "running",
        actorId: "user:test",
        clientId: "test-client",
      });
      expect(result.accepted).toBe(true);
    } finally {
      recoveredRuntime.manager.close();
    }
  });

  it("does not expire an unanswered authority Card over elapsed time", async () => {
    const { store, manager } = createStore();
    try {
      startThothTurn(store);
      const { record } = createDecision(store);
      vi.useFakeTimers();
      await vi.advanceTimersByTimeAsync(365 * 24 * 60 * 60 * 1_000);

      expect(store.getCard(record.cardId)).toMatchObject({ status: "pending" });
      expect(store.getState("agent-1")).toMatchObject({ lifecycle: "awaiting_card" });
    } finally {
      manager.close();
    }
  });
});
