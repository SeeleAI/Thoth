import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AgentTimelineItem,
  ThothToolExecutionContext,
  ThothToolRuntimeScope,
} from "@thoth/drivers/agent-runtime";
import { THOTH_RUNTIME_TOOL_NAMES } from "@thoth/protocol/thoth-runtime-contract";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import type { AgentStorage } from "../agent-storage.js";
import type { ExecutionService, ManagedAgent } from "../execution-service.js";
import type { ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import {
  resetClarifyChallengeBrokerForTest,
  waitForClarifyChallenge,
} from "../clarify-audit-broker.js";
import {
  ToolGateway,
  WorkspaceAuthorityManager,
  WorkspaceForegroundAuthority,
  type ToolResultSink,
} from "../../workspace-authority/index.js";
import { createThothToolCatalog } from "./thoth-tools.js";

const roots: string[] = [];
const managers: WorkspaceAuthorityManager[] = [];

function providerCall(toolName: string, callId = `call-${toolName}`): ThothToolExecutionContext {
  return {
    providerToolCall: {
      provider: "fixture",
      threadId: "provider-thread-1",
      turnId: "provider-turn-1",
      callId,
      toolName,
      isActiveProviderTurn: true,
    },
  };
}

function semanticToolNames(catalog: ReturnType<typeof createThothToolCatalog>): string[] {
  const semantic = new Set<string>(THOTH_RUNTIME_TOOL_NAMES);
  return [...catalog.tools.keys()].filter((name) => semantic.has(name));
}

function createEnvironment(input: {
  scope: ThothToolRuntimeScope;
  foregroundKind?: "thoth_clarify" | "raw_provider";
  clarifyStrength?: "auto" | "light" | "balanced" | "dive";
}) {
  const home = mkdtempSync(join(tmpdir(), "thoth-tools-final-contract-"));
  roots.push(home);
  const manager = new WorkspaceAuthorityManager(home);
  managers.push(manager);
  manager.catalog.upsertWorkspace({
    id: "workspace-test",
    canonicalPath: "/workspace/test",
    displayName: "Tool Test Workspace",
    kind: "workspace",
    parentWorkspaceId: null,
    archivedAt: null,
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
  });
  const authority = new WorkspaceForegroundAuthority(manager);
  const timeline: AgentTimelineItem[] = [];
  const cancelAgentRun = vi.fn(async () => true);
  const agent = {
    id: "agent-1",
    provider: "fixture",
    cwd: "/workspace/test",
    workspaceId: "workspace-test",
    labels: {},
    config: { provider: "fixture", cwd: "/workspace/test" },
  } as ManagedAgent;
  const executionService = {
    appendTimelineItem: vi.fn(async (agentId: string, item: AgentTimelineItem) => {
      if (agentId === agent.id) timeline.push(item);
    }),
    getAgent: vi.fn((agentId: string) => (agentId === agent.id ? agent : null)),
    getTimeline: vi.fn(() => [...timeline]),
    cancelAgentRun,
  } as unknown as ExecutionService;
  const sink = {
    submitCheckpoint: vi.fn<ToolResultSink["submitCheckpoint"]>(() => true),
    submitReviewDecision: vi.fn<ToolResultSink["submitReviewDecision"]>(() => true),
    requestHumanDecision: vi.fn<ToolResultSink["requestHumanDecision"]>(() => true),
    reportBlocked: vi.fn<ToolResultSink["reportBlocked"]>(() => true),
  };
  const gateway = new ToolGateway(sink);

  let clarifySessionId: string | null = null;
  let decisionRootNodeId: string | null = null;
  if (input.scope === "clarify") {
    const foregroundKind = input.foregroundKind ?? "thoth_clarify";
    const clarifyStrength = input.clarifyStrength ?? "dive";
    const started = authority.startTurn({
      agentId: agent.id,
      kind: foregroundKind === "thoth_clarify" ? "thoth" : "raw",
      ...(foregroundKind === "thoth_clarify"
        ? { controls: { mode: "quick" as const, clarifyStrength, loop: null } }
        : {}),
      sourceMessageId: `message-${foregroundKind}`,
      workspaceId: "workspace-test",
      workspacePath: agent.cwd,
      userText: "Design the final runtime boundary.",
    });
    if (foregroundKind === "thoth_clarify") {
      const decisionTree = authority.startDecisionSession({
        agentId: agent.id,
        turnId: started.turn.id,
        requestedStrength: clarifyStrength,
      });
      clarifySessionId = decisionTree.session.id;
      decisionRootNodeId = decisionTree.session.rootNodeId;
    }
    gateway.beginForegroundTurn({
      agentId: agent.id,
      workspaceId: "workspace-test",
      generation: started.turn.generation,
      kind: foregroundKind,
      foregroundTurnId: started.turn.id,
    });
    gateway.bindForegroundProviderTurn({
      agentId: agent.id,
      generation: started.turn.generation,
      providerTurnId: "provider-turn-1",
    });
  } else if (input.scope === "loop_execute" || input.scope === "loop_review") {
    gateway.bind(agent.id, {
      workspaceId: "workspace-test",
      taskId: "task-1",
      workUnitId: "work-unit-1",
      cycleId: "cycle-1",
      executionId: "execution-1",
      generation: "generation-1",
      phase: input.scope === "loop_execute" ? "execute" : "review",
    });
  }

  const catalog = createThothToolCatalog({
    executionService,
    agentStorage: {} as AgentStorage,
    providerSnapshotManager: {} as ProviderSnapshotManager,
    logger: createTestLogger(),
    workspaceAuthorityManager: manager,
    callerAgentId: agent.id,
    callerAgentConfig: agent.config,
    runtimeScope: input.scope,
    toolGateway: gateway,
  });
  return {
    authority,
    cancelAgentRun,
    catalog,
    clarifySessionId,
    decisionRootNodeId,
    gateway,
    manager,
    sink,
    timeline,
  };
}

const resolvedMap = (parentId: string | null) => ({
  effectiveStrength: "dive" as const,
  publicSummary: "Workspace evidence resolves the execution boundary.",
  nodes: [
    {
      id: "objective",
      parentId,
      crossLinkIds: [],
      title: "Objective boundary",
      summary: "Grounded from Workspace evidence.",
      owner: "agent" as const,
      materiality: "structural" as const,
      status: "resolved" as const,
      resolutionRef: "agent:grounded-objective",
      sourceRefs: ["workspace:README.md"],
    },
  ],
});

afterEach(() => {
  resetClarifyChallengeBrokerForTest();
  for (const manager of managers.splice(0)) manager.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("final Thoth semantic tool catalog", () => {
  it("publishes exactly the semantic tools owned by each runtime scope", () => {
    expect(semanticToolNames(createEnvironment({ scope: "clarify" }).catalog)).toEqual([
      "thoth_clarify_update_map",
      "thoth_clarify_ask",
      "thoth_clarify_propose_contract",
      "thoth_clarify_report_blocked",
    ]);
    expect(semanticToolNames(createEnvironment({ scope: "clarify_challenger" }).catalog)).toEqual([
      "thoth_clarify_judge_contract",
    ]);
    expect(semanticToolNames(createEnvironment({ scope: "loop_execute" }).catalog)).toEqual([
      "thoth_loop_checkpoint",
      "thoth_loop_request_human_decision",
      "thoth_loop_report_blocked",
    ]);
    expect(semanticToolNames(createEnvironment({ scope: "loop_review" }).catalog)).toEqual([
      "thoth_loop_review_decision",
      "thoth_loop_request_human_decision",
      "thoth_loop_report_blocked",
    ]);
  });

  it("rejects remembered Clarify tools during a raw Provider turn", async () => {
    const { catalog } = createEnvironment({ scope: "clarify", foregroundKind: "raw_provider" });
    await expect(
      catalog.executeTool(
        "thoth_clarify_update_map",
        resolvedMap(null),
        providerCall("thoth_clarify_update_map"),
      ),
    ).rejects.toMatchObject({ code: "THOTH_RUNTIME_INACTIVE" });
  });

  it("persists visible Decision Tree conclusions without hidden reasoning", async () => {
    const { authority, catalog, clarifySessionId, decisionRootNodeId, timeline } =
      createEnvironment({
        scope: "clarify",
      });
    const map = resolvedMap(decisionRootNodeId);
    const result = await catalog.executeTool(
      "thoth_clarify_update_map",
      map,
      providerCall("thoth_clarify_update_map", "call-map"),
    );

    expect(result.structuredContent).toMatchObject({ ok: true, sessionId: clarifySessionId });
    const snapshot = authority.getDecisionTree("agent-1");
    expect(snapshot).toMatchObject({ session: { effectiveStrength: "dive" } });
    expect(snapshot?.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "objective", owner: "agent", status: "resolved" }),
      ]),
    );
    expect(timeline).toContainEqual(
      expect.objectContaining({
        type: "tool_call",
        callId: "call-map",
        status: "completed",
        detail: expect.objectContaining({ text: map.publicSummary }),
      }),
    );
    expect(JSON.stringify(timeline)).not.toContain("chain-of-thought");
  });

  it("lets the Provider establish effective Clarify depth from an auto turn snapshot", async () => {
    const { authority, catalog, decisionRootNodeId } = createEnvironment({
      scope: "clarify",
      clarifyStrength: "auto",
    });
    expect(authority.getDecisionTree("agent-1")).toMatchObject({
      session: { requestedStrength: "auto", effectiveStrength: null },
    });

    await catalog.executeTool(
      "thoth_clarify_update_map",
      { ...resolvedMap(decisionRootNodeId), effectiveStrength: "balanced" },
      providerCall("thoth_clarify_update_map", "call-auto-strength"),
    );

    expect(authority.getDecisionTree("agent-1")).toMatchObject({
      session: { requestedStrength: "auto", effectiveStrength: "balanced" },
    });
  });

  it("opens one durable Clarify Card only for mapped Human-owned nodes and parks the turn", async () => {
    const { authority, cancelAgentRun, catalog, decisionRootNodeId, gateway, timeline } =
      createEnvironment({
        scope: "clarify",
      });
    await catalog.executeTool(
      "thoth_clarify_update_map",
      {
        effectiveStrength: "dive",
        publicSummary: "The delivery boundary remains Human-owned.",
        nodes: [
          {
            id: "delivery",
            parentId: decisionRootNodeId,
            crossLinkIds: [],
            title: "Delivery boundary",
            summary: "Waiting for a product-level delivery decision.",
            owner: "human",
            materiality: "structural",
            status: "awaiting_human",
            resolutionRef: null,
            sourceRefs: [],
          },
        ],
      },
      providerCall("thoth_clarify_update_map"),
    );
    const result = await catalog.executeTool(
      "thoth_clarify_ask",
      {
        title: "Choose the delivery boundary",
        whyNow: "This branch changes the public product contract.",
        publicSummary: "Waiting for the delivery boundary decision.",
        allowChoiceNotes: true,
        allowNoteOnly: true,
        allowSingleNodeRecommendation: true,
        allowSubtreeDelegation: true,
        questions: [
          {
            nodeId: "delivery",
            question: "Which delivery boundary should the task freeze?",
            selectionMode: "single",
            choices: [
              { id: "library", label: "Library", description: "Reusable API" },
              { id: "cli", label: "CLI", description: "Command-line product" },
            ],
            recommendedChoiceId: "library",
          },
        ],
      },
      providerCall("thoth_clarify_ask", "call-ask"),
    );

    expect(result.structuredContent).toMatchObject({ ok: true, status: "awaiting_user" });
    expect(authority.getState("agent-1")).toMatchObject({
      lifecycle: "awaiting_card",
      pendingCard: { kind: "clarify_card" },
    });
    expect(
      gateway.isParkedProviderTurn({ agentId: "agent-1", providerTurnId: "provider-turn-1" }),
    ).toBe(true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(cancelAgentRun).toHaveBeenCalledWith("agent-1");
    expect(timeline.filter((item) => item.type === "clarify_card")).toHaveLength(1);
  });

  it("rejects duplicate, closed, non-Human, and low-value Clarify frontiers", async () => {
    const { catalog, decisionRootNodeId } = createEnvironment({ scope: "clarify" });
    await catalog.executeTool(
      "thoth_clarify_update_map",
      {
        effectiveStrength: "dive",
        publicSummary: "Expose valid and invalid frontier candidates.",
        nodes: [
          {
            id: "human-open",
            parentId: decisionRootNodeId,
            crossLinkIds: [],
            title: "Material Human choice",
            summary: "Waiting for a material Human choice.",
            owner: "human",
            materiality: "material",
            status: "open",
            resolutionRef: null,
            sourceRefs: [],
          },
          {
            id: "human-resolved",
            parentId: decisionRootNodeId,
            crossLinkIds: [],
            title: "Resolved Human choice",
            summary: "The Human choice is already resolved.",
            owner: "human",
            materiality: "material",
            status: "resolved",
            resolutionRef: "decision:resolved",
            sourceRefs: [],
          },
          {
            id: "workspace-fact",
            parentId: decisionRootNodeId,
            crossLinkIds: [],
            title: "Discoverable Workspace fact",
            summary: "This fact must be resolved from Workspace evidence.",
            owner: "evidence",
            materiality: "material",
            status: "open",
            resolutionRef: null,
            sourceRefs: [],
          },
          {
            id: "local-detail",
            parentId: "human-open",
            crossLinkIds: [],
            title: "Local implementation detail",
            summary: "This local detail is below the Human decision threshold.",
            owner: "human",
            materiality: "local",
            status: "open",
            resolutionRef: null,
            sourceRefs: [],
          },
        ],
      },
      providerCall("thoth_clarify_update_map", "call-invalid-map"),
    );
    const question = (nodeId: string) => ({
      nodeId,
      question: `Should the Human decide ${nodeId}?`,
      selectionMode: "single" as const,
      choices: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
      recommendedChoiceId: "yes",
    });
    const ask = (nodeIds: string[]) => ({
      title: "Invalid frontier probe",
      whyNow: "Exercise the production frontier validator.",
      publicSummary: "This invalid Card must be rejected.",
      questions: nodeIds.map(question),
    });

    await expect(
      catalog.executeTool(
        "thoth_clarify_ask",
        ask(["human-open", "human-open"]),
        providerCall("thoth_clarify_ask", "call-duplicate"),
      ),
    ).rejects.toThrow(/duplicate_node/u);
    await expect(
      catalog.executeTool(
        "thoth_clarify_ask",
        ask(["human-resolved"]),
        providerCall("thoth_clarify_ask", "call-resolved"),
      ),
    ).rejects.toThrow(/frontier_closed/u);
    await expect(
      catalog.executeTool(
        "thoth_clarify_ask",
        ask(["workspace-fact"]),
        providerCall("thoth_clarify_ask", "call-evidence"),
      ),
    ).rejects.toThrow(/owner_not_human/u);
    await expect(
      catalog.executeTool(
        "thoth_clarify_ask",
        ask(["local-detail"]),
        providerCall("thoth_clarify_ask", "call-local"),
      ),
    ).rejects.toThrow(/low_materiality/u);
  });

  it("proposes one Intent Contract only after the material frontier is resolved", async () => {
    const { authority, catalog, decisionRootNodeId } = createEnvironment({ scope: "clarify" });
    await catalog.executeTool(
      "thoth_clarify_update_map",
      resolvedMap(decisionRootNodeId),
      providerCall("thoth_clarify_update_map"),
    );
    const result = await catalog.executeTool(
      "thoth_clarify_propose_contract",
      {
        contract: {
          title: "Final runtime boundary",
          objective: "Ship one provider-neutral runtime boundary.",
          nonGoals: ["Do not add a compatibility path."],
          invariants: ["Task authority remains in the Workspace shard."],
          acceptance: ["Every Provider passes the shared Harness conformance suite."],
          riskBoundary: ["No hidden provider credentials are persisted."],
          humanDecisionRefs: [],
          escalationPolicy: { returnToHumanWhen: [], finalConfirmation: "automatic" },
        },
        decisionNodeRefs: ["objective"],
        publicSummary: "The stable Intent Contract is ready for one fresh Challenger.",
      },
      providerCall("thoth_clarify_propose_contract", "call-contract"),
    );

    expect(result.structuredContent).toMatchObject({ ok: true, status: "challenging" });
    expect(authority.getDecisionTree("agent-1")).toMatchObject({
      session: {
        lifecycle: "active",
        activity: { state: "challenging" },
        intentContract: {
          status: "proposed",
          objective: "Ship one provider-neutral runtime boundary.",
        },
      },
    });
    expect(authority.getState("agent-1").lifecycle).toBe("challenging");
  });

  it("delivers exactly one fresh Challenger judgment through its internal scope", async () => {
    const waiting = waitForClarifyChallenge("agent-1");
    const { catalog } = createEnvironment({ scope: "clarify_challenger" });
    await expect(
      catalog.executeTool("thoth_clarify_judge_contract", {
        decision: "stable",
        reason: "The contract preserves every material boundary.",
        missingNodes: [],
      }),
    ).resolves.toMatchObject({ structuredContent: { ok: true } });
    await expect(waiting).resolves.toEqual({
      decision: "stable",
      reason: "The contract preserves every material boundary.",
      missingNodes: [],
    });
    await expect(
      catalog.executeTool("thoth_clarify_judge_contract", {
        decision: "stable",
        reason: "A second judgment is forbidden.",
        missingNodes: [],
      }),
    ).rejects.toThrow("No pending Clarify Challenger");
  });

  it("binds checkpoint identity from the active Execute generation", async () => {
    const { catalog, sink } = createEnvironment({ scope: "loop_execute" });
    const checkpoint = {
      title: "Provider-neutral adapter landed",
      activeGap: "Prove the adapter boundary.",
      progressClaim: "The adapter now emits a durable receipt.",
      unresolvedGap: "Run fresh independent Review.",
      evidenceRefs: ["evidence-adapter-test"],
    };
    await expect(
      catalog.executeTool(
        "thoth_loop_checkpoint",
        checkpoint,
        providerCall("thoth_loop_checkpoint", "provider-call-checkpoint"),
      ),
    ).resolves.toMatchObject({ structuredContent: { ok: true, status: "accepted" } });
    expect(sink.submitCheckpoint).toHaveBeenCalledWith({
      binding: expect.objectContaining({
        workspaceId: "workspace-test",
        taskId: "task-1",
        workUnitId: "work-unit-1",
        cycleId: "cycle-1",
        executionId: "execution-1",
        generation: "generation-1",
        phase: "execute",
      }),
      checkpoint,
      providerTurnId: "provider-turn-1",
      callId: "provider-call-checkpoint",
    });
  });

  it("keeps fresh Review minimal and routes Human/blocker decisions through the same binding", async () => {
    const { catalog, sink } = createEnvironment({ scope: "loop_review" });
    const review = {
      decision: "complete" as const,
      reason: "Independent inspection proves the complete Task Anchor.",
      evidenceRefs: ["evidence-review"],
      nextFocus: "",
      rejectedRoutes: [],
      acceptanceEvidence: { "acceptance-1": ["evidence-review"] },
    };
    await catalog.executeTool(
      "thoth_loop_review_decision",
      review,
      providerCall("thoth_loop_review_decision", "provider-call-review"),
    );
    expect(sink.submitReviewDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        review,
        providerTurnId: "provider-turn-1",
        callId: "provider-call-review",
        binding: expect.objectContaining({ phase: "review", cycleId: "cycle-1" }),
      }),
    );

    const request = {
      title: "Choose the new risk boundary",
      question: "May this Task expand beyond the confirmed Workspace?",
      affectedContractFields: ["riskBoundary"],
      options: [
        { id: "stay", label: "Stay scoped" },
        { id: "expand", label: "Expand scope" },
      ],
    };
    await catalog.executeTool(
      "thoth_loop_request_human_decision",
      request,
      providerCall("thoth_loop_request_human_decision", "provider-call-human"),
    );
    expect(sink.requestHumanDecision).toHaveBeenCalledWith(
      expect.objectContaining({ request, callId: "provider-call-human" }),
    );

    const blocked = {
      title: "External service unavailable",
      reason: "The required service is offline.",
    };
    await expect(
      catalog.executeTool(
        "thoth_loop_report_blocked",
        blocked,
        providerCall("thoth_loop_report_blocked", "provider-call-blocked"),
      ),
    ).resolves.toMatchObject({ isError: true, structuredContent: { status: "blocked" } });
    expect(sink.reportBlocked).toHaveBeenCalledWith(
      expect.objectContaining({ report: blocked, callId: "provider-call-blocked" }),
    );
  });
});
