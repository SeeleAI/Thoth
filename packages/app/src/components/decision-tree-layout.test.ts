import { describe, expect, it } from "vitest";
import type {
  DecisionNodeProjection,
  DecisionTreeDelta,
  DecisionTreeSnapshot,
} from "@thoth/protocol/clarify-authority";
import {
  applyDecisionTreeDelta,
  buildDecisionTreeLayout,
  buildDecisionTreeScene,
  decisionTreeNavigationTarget,
  fitDecisionTreeViewport,
  visibleDecisionTreeNodeIds,
} from "./decision-tree-layout";

const NOW = "2026-07-31T00:00:00.000Z";

function node(
  id: string,
  parentId: string | null,
  input: Partial<DecisionNodeProjection> = {},
): DecisionNodeProjection {
  return {
    id,
    parentId,
    crossLinkIds: [],
    title: `Decision ${id}`,
    summary: `Summary ${id}`,
    owner: "agent",
    materiality: "material",
    status: "resolved",
    resolutionRef: `agent:${id}`,
    sourceRefs: [],
    priority: 100,
    revision: 1,
    ...input,
  };
}

function snapshot(nodes: DecisionNodeProjection[], revision = 1): DecisionTreeSnapshot {
  return {
    session: {
      id: "decision-session-1",
      workspaceId: "workspace-1",
      agentId: "agent-1",
      originTurnId: "turn-1",
      activeTurnId: "turn-1",
      requestedStrength: "dive",
      effectiveStrength: "dive",
      lifecycle: "active",
      challengerUsed: false,
      rootNodeId: "root",
      priorityNodeId: null,
      activeCardId: null,
      intentContract: null,
      taskId: null,
      activity: {
        state: "expanding",
        activeNodeId: "active-leaf",
        summary: "Expanding the material frontier",
        startedAt: NOW,
        updatedAt: NOW,
      },
      revision,
      createdAt: NOW,
      updatedAt: NOW,
      frozenAt: null,
    },
    nodes,
    cardReceipts: [],
    revision,
  };
}

describe("decision tree layout", () => {
  it("creates a deterministic left-to-right tidy tree without node overlap", () => {
    const tree = snapshot([
      node("root", null, { materiality: "structural" }),
      node("a", "root", { priority: 3 }),
      node("b", "root", { priority: 2 }),
      node("a-1", "a", { priority: 2 }),
      node("a-2", "a", { priority: 1 }),
      node("active-leaf", "b", { owner: "human", status: "awaiting_human", resolutionRef: null }),
    ]);
    const first = buildDecisionTreeLayout({ snapshot: tree });
    const second = buildDecisionTreeLayout({ snapshot: tree });
    expect(first.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(
      second.nodes.map(({ id, x, y }) => ({ id, x, y })),
    );
    for (const edge of first.edges) {
      expect(first.nodeById.get(edge.toId)!.x).toBeGreaterThan(first.nodeById.get(edge.fromId)!.x);
    }
    const boxes = first.nodes.map((entry) => ({
      id: entry.id,
      left: entry.x,
      right: entry.x + entry.width,
      top: entry.y,
      bottom: entry.y + entry.height,
    }));
    for (let leftIndex = 0; leftIndex < boxes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < boxes.length; rightIndex += 1) {
        const left = boxes[leftIndex]!;
        const right = boxes[rightIndex]!;
        const overlaps =
          left.left < right.right &&
          left.right > right.left &&
          left.top < right.bottom &&
          left.bottom > right.top;
        expect(overlaps, `${left.id} overlaps ${right.id}`).toBe(false);
      }
    }
    expect(first.nodes.every((entry) => entry.height >= 96)).toBe(true);
  });

  it("fits small trees from a stable top-left inset", () => {
    const layout = buildDecisionTreeLayout({
      snapshot: snapshot([node("root", null), node("active-leaf", "root")]),
    });
    const viewport = fitDecisionTreeViewport({ layout, width: 900, height: 700 });
    expect(viewport).toMatchObject({ panX: 28, panY: 28, scale: 1 });
  });

  it("includes the frozen Task leaf in scene bounds and routes above decision nodes", () => {
    const layout = buildDecisionTreeLayout({
      snapshot: snapshot([
        node("root", null),
        node("branch-a", "root", { priority: 2 }),
        node("branch-b", "root", { priority: 1 }),
        node("active-leaf", "branch-b"),
      ]),
    });
    const scene = buildDecisionTreeScene({
      layout,
      rootNodeId: "root",
      includeTask: true,
    });
    expect(scene.taskNode).not.toBeNull();
    expect(scene.taskNode!.x + scene.taskNode!.width).toBeLessThan(scene.width);
    expect(scene.taskNode!.y + scene.taskNode!.height).toBeLessThan(scene.height);
    const safeLane = scene.taskConnector[2]!.y;
    expect(safeLane).toBeLessThan(Math.min(...layout.nodes.map((entry) => entry.y)));

    const intersectsInterior = (
      start: { x: number; y: number },
      end: { x: number; y: number },
      entry: (typeof layout.nodes)[number],
    ) => {
      const left = entry.x;
      const right = entry.x + entry.width;
      const top = entry.y;
      const bottom = entry.y + entry.height;
      if (start.y === end.y) {
        return (
          start.y > top &&
          start.y < bottom &&
          Math.max(Math.min(start.x, end.x), left) < Math.min(Math.max(start.x, end.x), right)
        );
      }
      return (
        start.x > left &&
        start.x < right &&
        Math.max(Math.min(start.y, end.y), top) < Math.min(Math.max(start.y, end.y), bottom)
      );
    };
    for (let index = 1; index < scene.taskConnector.length; index += 1) {
      const start = scene.taskConnector[index - 1]!;
      const end = scene.taskConnector[index]!;
      for (const entry of layout.nodes) {
        expect(intersectsInterior(start, end, entry), `Task route intersects ${entry.id}`).toBe(
          false,
        );
      }
    }
  });

  it("keeps an unaffected earlier branch stable when a later subtree grows", () => {
    const baseNodes = [
      node("root", null),
      node("a", "root", { priority: 3 }),
      node("a-1", "a"),
      node("b", "root", { priority: 2 }),
      node("active-leaf", "b", { status: "awaiting_human", owner: "human", resolutionRef: null }),
    ];
    const before = buildDecisionTreeLayout({ snapshot: snapshot(baseNodes) });
    const after = buildDecisionTreeLayout({
      snapshot: snapshot([...baseNodes, node("b-2", "b", { priority: 1 })], 2),
    });
    expect(after.nodeById.get("a")).toMatchObject({
      x: before.nodeById.get("a")!.x,
      y: before.nodeById.get("a")!.y,
    });
    expect(after.nodeById.get("a-1")).toMatchObject({
      x: before.nodeById.get("a-1")!.x,
      y: before.nodeById.get("a-1")!.y,
    });
  });

  it("auto-folds large completed branches but never folds the active path", () => {
    const nodes = [node("root", null), node("done", "root"), node("active", "root")];
    for (let index = 0; index < 250; index += 1) {
      nodes.push(node(`done-${index}`, index === 0 ? "done" : `done-${index - 1}`));
      nodes.push(
        node(`active-${index}`, index === 0 ? "active" : `active-${index - 1}`, {
          status: index === 249 ? "awaiting_human" : "resolved",
          owner: index === 249 ? "human" : "agent",
          resolutionRef: index === 249 ? null : `agent:active-${index}`,
        }),
      );
    }
    nodes.push(
      node("active-leaf", "active-249", {
        status: "awaiting_human",
        owner: "human",
        resolutionRef: null,
      }),
    );
    const layout = buildDecisionTreeLayout({ snapshot: snapshot(nodes) });
    expect(layout.autoCollapsedNodeIds.has("done")).toBe(true);
    expect(layout.nodeById.get("done")?.hiddenDescendantCount).toBe(250);
    expect(layout.nodeById.has("done-249")).toBe(false);
    expect(layout.nodeById.has("active-249")).toBe(true);
    expect(layout.nodes.length).toBeLessThan(300);
  });

  it("opens matching paths for search and filter results", () => {
    const nodes = [node("root", null), node("done", "root")];
    for (let index = 0; index < 12; index += 1) {
      nodes.push(node(`done-${index}`, index === 0 ? "done" : `done-${index - 1}`));
    }
    nodes.push(
      node("active-leaf", "root", {
        owner: "human",
        status: "awaiting_human",
        resolutionRef: null,
      }),
    );
    const folded = buildDecisionTreeLayout({ snapshot: snapshot(nodes) });
    expect(folded.nodeById.has("done-11")).toBe(false);
    const searched = buildDecisionTreeLayout({ snapshot: snapshot(nodes), query: "done-11" });
    expect(searched.nodeById.has("done-11")).toBe(true);
  });

  it("supports standard visible-tree keyboard navigation", () => {
    const layout = buildDecisionTreeLayout({
      snapshot: snapshot([
        node("root", null),
        node("a", "root", { priority: 2 }),
        node("a-1", "a"),
        node("b", "root", { priority: 1 }),
        node("active-leaf", "b", {
          owner: "human",
          status: "awaiting_human",
          resolutionRef: null,
        }),
      ]),
    });
    expect(decisionTreeNavigationTarget(layout, "root", "ArrowRight")).toBe("a");
    expect(decisionTreeNavigationTarget(layout, "a", "ArrowRight")).toBe("a-1");
    expect(decisionTreeNavigationTarget(layout, "a-1", "ArrowLeft")).toBe("a");
    expect(decisionTreeNavigationTarget(layout, "a", "ArrowDown")).toBe("a-1");
    expect(decisionTreeNavigationTarget(layout, "a-1", "ArrowDown")).toBe("b");
    expect(decisionTreeNavigationTarget(layout, "root", "ArrowUp")).toBe("root");
  });

  it("fits a 500-level tree instead of clamping it outside the viewport", () => {
    const nodes = [node("root", null)];
    for (let index = 0; index < 499; index += 1) {
      nodes.push(
        node(`depth-${index}`, index === 0 ? "root" : `depth-${index - 1}`, {
          owner: index === 498 ? "human" : "agent",
          status: index === 498 ? "awaiting_human" : "resolved",
          resolutionRef: index === 498 ? null : `agent:depth-${index}`,
        }),
      );
    }
    nodes.push(
      node("active-leaf", "depth-498", {
        owner: "human",
        status: "awaiting_human",
        resolutionRef: null,
      }),
    );
    const layout = buildDecisionTreeLayout({ snapshot: snapshot(nodes) });
    const viewport = fitDecisionTreeViewport({ layout, width: 480, height: 320 });
    expect(layout.width * viewport.scale).toBeLessThanOrEqual(480);
    expect(layout.height * viewport.scale).toBeLessThanOrEqual(320);
    expect(viewport.scale).toBeLessThan(0.24);
  });

  it("applies ordered deltas, merges Card receipts, and rejects revision gaps", () => {
    const current = snapshot([node("root", null), node("active-leaf", "root")], 4);
    const delta: DecisionTreeDelta = {
      workspaceId: "workspace-1",
      agentId: "agent-1",
      sessionId: "decision-session-1",
      baseRevision: 4,
      revision: 5,
      session: { ...current.session, revision: 5, updatedAt: NOW },
      nodeUpserts: [node("next", "active-leaf", { revision: 1 })],
      removedNodeIds: [],
      cardReceipts: [
        {
          cardId: "card-1",
          sessionId: "decision-session-1",
          kind: "clarify_card",
          status: "answered",
          submittedSummary: "Use the recommended boundary",
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      emittedAt: NOW,
    };
    const applied = applyDecisionTreeDelta(current, delta);
    expect(applied.kind).toBe("applied");
    expect(applied.snapshot.nodes.some((entry) => entry.id === "next")).toBe(true);
    expect(applied.snapshot.cardReceipts).toHaveLength(1);
    expect(applyDecisionTreeDelta(current, { ...delta, baseRevision: 3 }).kind).toBe("gap");
    expect(applyDecisionTreeDelta(applied.snapshot, delta).kind).toBe("stale");
  });

  it("mounts only nodes near the transformed viewport", () => {
    const nodes = [node("root", null)];
    for (let index = 0; index < 100; index += 1) {
      nodes.push(node(`branch-${index}`, "root", { priority: 100 - index }));
    }
    nodes.push(
      node("active-leaf", "branch-99", {
        status: "awaiting_human",
        owner: "human",
        resolutionRef: null,
      }),
    );
    const layout = buildDecisionTreeLayout({
      snapshot: snapshot(nodes),
      expandedNodeIds: new Set(["root"]),
    });
    const visible = visibleDecisionTreeNodeIds(layout, {
      width: 480,
      height: 320,
      panX: 0,
      panY: 0,
      scale: 1,
    });
    expect(visible.size).toBeGreaterThan(0);
    expect(visible.size).toBeLessThan(layout.nodes.length / 2);
  });
});
