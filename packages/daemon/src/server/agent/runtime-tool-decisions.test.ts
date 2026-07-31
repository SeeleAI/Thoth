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

function clarifyCard(sessionId: string): ThothClarifyCardModel {
  return {
    id: "clarify-card-persist",
    sessionId,
    roundIndex: 1,
    submitted: false,
    card: {
      title: "确认目标边界",
      whyNow: "这些选择会改变任务路线。",
      publicSummary: "正在拆解目标边界。",
      allowChoiceNotes: true,
      allowNoteOnly: true,
      allowSingleNodeRecommendation: true,
      allowSubtreeDelegation: true,
      questions: [
        {
          nodeId: "language",
          question: "用什么语言实现？",
          selectionMode: "single",
          choices: [
            { id: "cpp", label: "C++", description: "贴近系统性能" },
            { id: "rust", label: "Rust", description: "安全且高性能" },
          ],
          recommendedChoiceId: "cpp",
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

function startThothTurn(store: WorkspaceForegroundAuthority): string {
  const started = store.startTurn({
    agentId: "agent-1",
    kind: "thoth",
    controls: { mode: "quick", clarifyStrength: "dive", loop: null },
    sourceMessageId: "message-1",
    workspaceId: "workspace-test",
    workspacePath: "/workspace/thoth",
    userText: "实现一个高性能工具",
  });
  const session = store.startDecisionSession({
    agentId: "agent-1",
    turnId: started.turn.id,
    requestedStrength: "dive",
  });
  store.updateDecisionTree({
    agentId: "agent-1",
    sessionId: session.session.id,
    update: {
      effectiveStrength: "dive",
      activity: "expanding",
      activeNodeId: "language",
      publicSummary: "语言是当前高价值 Human-owned 分叉。",
      nodes: [
        {
          id: "language",
          parentId: session.session.rootNodeId,
          crossLinkIds: [],
          title: "实现语言",
          summary: null,
          owner: "human",
          materiality: "structural",
          status: "awaiting_human",
          resolutionRef: null,
          sourceRefs: [],
        },
      ],
    },
  });
  return session.session.id;
}

function createDecision(store: WorkspaceForegroundAuthority, sessionId: string) {
  return createRuntimeAuthorityDecision({
    store,
    provider: "codex",
    agentId: "agent-1",
    threadId: "thread-1",
    providerTurnId: "turn-1",
    callId: "call-1",
    toolName: "thoth_clarify_ask",
    card: { kind: "clarify_card", card: clarifyCard(sessionId) },
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
    const sessionId = startThothTurn(store);
    const { record } = createDecision(store, sessionId);
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
        questionCardId: record.cardId,
        answers: [
          {
            nodeId: "language",
            choiceIds: ["cpp"],
            choiceNotes: {},
          },
        ],
        delegatedNodeIds: [],
        rawAnswer: "选择 C++",
      };
      const state = recovered.getState("agent-1");
      const result = recovered.answerCard({
        agentId: "agent-1",
        cardId: record.cardId,
        answer,
        submittedCard: {
          ...clarifyCard(sessionId),
          submitted: true,
          submittedSummary: "选择 C++",
        },
        submittedSummary: "选择 C++",
        expectedRevision: state.revision,
        commandId: "answer-after-restart",
        nextLifecycle: "running",
        actorId: "user:test",
        clientId: "test-client",
      });
      expect(result.accepted).toBe(true);
      expect(result.card).toMatchObject({
        kind: "clarify_card",
        status: "answered",
        card: { id: record.cardId, submitted: true, submittedSummary: "选择 C++" },
      });
      expect(result.decisionTreeDelta).toMatchObject({
        sessionId,
        baseRevision: expect.any(Number),
        revision: expect.any(Number),
        cardReceipts: [expect.objectContaining({ cardId: record.cardId, status: "answered" })],
      });
      expect(result.decisionTreeDelta!.revision).toBeGreaterThan(
        result.decisionTreeDelta!.baseRevision,
      );
    } finally {
      recoveredRuntime.manager.close();
    }
  });

  it("reprojects the same Timeline Card row as a submitted receipt after restart", () => {
    const { home, store, manager } = createStore();
    manager.forWorkspace("workspace-test").upsertAgentRecord({
      id: "agent-1",
      provider: "fixture",
      cwd: "/workspace/thoth",
      workspaceId: "workspace-test",
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z",
      labels: {},
      lastStatus: "idle",
      providerRunMode: "default",
      providerControlRevision: 0,
    });
    const sessionId = startThothTurn(store);
    const { record } = createDecision(store, sessionId);
    const authority = manager.forAgent("agent-1");
    expect(authority).not.toBeNull();
    authority!.appendAgentTimelineRows("agent-1", [
      {
        seq: 1,
        timestamp: "2026-07-31T00:00:00.000Z",
        item: { type: "clarify_card", card: clarifyCard(sessionId) },
      },
    ]);

    const state = store.getState("agent-1");
    const result = store.answerCard({
      agentId: "agent-1",
      cardId: record.cardId,
      answer: {
        intent: "submit_choices",
        questionCardId: record.cardId,
        answers: [
          {
            nodeId: "language",
            choiceIds: ["cpp"],
            choiceNotes: {},
          },
        ],
        delegatedNodeIds: [],
        rawAnswer: "选择 C++",
      },
      submittedCard: {
        ...clarifyCard(sessionId),
        submitted: true,
        submittedSummary: "选择 C++",
      },
      submittedSummary: "选择 C++",
      expectedRevision: state.revision,
      commandId: "answer-before-timeline-restart",
      nextLifecycle: "running",
      actorId: "user:test",
      clientId: "test-client",
    });
    expect(result.accepted).toBe(true);
    manager.close();

    const recoveredRuntime = createStore(home);
    try {
      expect(
        recoveredRuntime.manager.forAgent("agent-1")!.listAgentTimelineRows("agent-1"),
      ).toEqual([
        {
          seq: 1,
          timestamp: "2026-07-31T00:00:00.000Z",
          item: {
            type: "clarify_card",
            card: expect.objectContaining({
              id: record.cardId,
              submitted: true,
              submittedSummary: "选择 C++",
            }),
          },
        },
      ]);
    } finally {
      recoveredRuntime.manager.close();
    }
  });

  it("does not expire an unanswered authority Card over elapsed time", async () => {
    const { store, manager } = createStore();
    try {
      const sessionId = startThothTurn(store);
      const { record } = createDecision(store, sessionId);
      vi.useFakeTimers();
      await vi.advanceTimersByTimeAsync(365 * 24 * 60 * 60 * 1_000);

      expect(store.getCard(record.cardId)).toMatchObject({ status: "pending" });
      expect(store.getState("agent-1")).toMatchObject({ lifecycle: "awaiting_card" });
    } finally {
      manager.close();
    }
  });
});
