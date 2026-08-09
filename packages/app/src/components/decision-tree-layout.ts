import type {
  DecisionNodeProjection,
  DecisionTreeDelta,
  DecisionTreeSnapshot,
} from "@thoth/protocol/clarify-authority";

export type DecisionTreeFilter = "all" | "needs_human" | "changed";
export type DecisionTreeNavigationKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

export interface DecisionTreeLayoutNode {
  id: string;
  node: DecisionNodeProjection;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  collapsed: boolean;
  childCount: number;
  hiddenDescendantCount: number;
}

export interface DecisionTreeLayoutEdge {
  fromId: string;
  toId: string;
}

export interface DecisionTreeLayout {
  nodes: DecisionTreeLayoutNode[];
  nodeById: ReadonlyMap<string, DecisionTreeLayoutNode>;
  edges: DecisionTreeLayoutEdge[];
  width: number;
  height: number;
  activePath: ReadonlySet<string>;
  autoCollapsedNodeIds: ReadonlySet<string>;
}

export interface DecisionTreeScenePoint {
  x: number;
  y: number;
}

export interface DecisionTreeTaskNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DecisionTreeScene {
  width: number;
  height: number;
  taskNode: DecisionTreeTaskNode | null;
  taskConnector: readonly DecisionTreeScenePoint[];
}

export interface DecisionTreeViewport {
  width: number;
  height: number;
  panX: number;
  panY: number;
  scale: number;
}

export type DecisionTreeDeltaResult =
  | { kind: "applied"; snapshot: DecisionTreeSnapshot }
  | { kind: "stale"; snapshot: DecisionTreeSnapshot }
  | { kind: "unrelated"; snapshot: DecisionTreeSnapshot }
  | { kind: "gap"; snapshot: DecisionTreeSnapshot };

const NODE_WIDTH = 196;
const NODE_HEIGHT = 96;
const COLUMN_GAP = 56;
const ROW_GAP = 18;
const SCENE_PADDING = 32;
const TASK_WIDTH = 196;
const TASK_HEIGHT = 64;
const TASK_GAP = 48;
const TASK_APPROACH_GAP = 24;
const AUTO_COLLAPSE_DESCENDANT_THRESHOLD = 8;

function compareNodes(left: DecisionNodeProjection, right: DecisionNodeProjection): number {
  return (
    right.priority - left.priority ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  );
}

function parentPath(
  nodeId: string | null,
  nodes: ReadonlyMap<string, DecisionNodeProjection>,
): Set<string> {
  const result = new Set<string>();
  let current = nodeId;
  while (current && !result.has(current)) {
    result.add(current);
    current = nodes.get(current)?.parentId ?? null;
  }
  return result;
}

function buildDescendantCounts(
  nodes: readonly DecisionNodeProjection[],
  children: ReadonlyMap<string, readonly DecisionNodeProjection[]>,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  const visiting = new Set<string>();
  const count = (nodeId: string): number => {
    const cached = counts.get(nodeId);
    if (cached !== undefined) return cached;
    if (visiting.has(nodeId)) return 0;
    visiting.add(nodeId);
    const total = (children.get(nodeId) ?? []).reduce((sum, child) => sum + 1 + count(child.id), 0);
    visiting.delete(nodeId);
    counts.set(nodeId, total);
    return total;
  };
  for (const node of nodes) count(node.id);
  return counts;
}

function buildIncludedNodes(input: {
  snapshot: DecisionTreeSnapshot;
  nodes: ReadonlyMap<string, DecisionNodeProjection>;
  query: string;
  filter: DecisionTreeFilter;
  changedNodeIds: ReadonlySet<string>;
  activePath: ReadonlySet<string>;
}): Set<string> {
  const normalizedQuery = input.query.trim().toLocaleLowerCase();
  const included = new Set<string>();
  for (const node of input.snapshot.nodes) {
    const matchesFilter =
      input.filter === "all" ||
      (input.filter === "needs_human" &&
        node.owner === "human" &&
        (node.status === "open" || node.status === "awaiting_human")) ||
      (input.filter === "changed" && input.changedNodeIds.has(node.id));
    const matchesQuery =
      normalizedQuery.length === 0 ||
      node.title.toLocaleLowerCase().includes(normalizedQuery) ||
      (node.summary ?? "").toLocaleLowerCase().includes(normalizedQuery);
    if (matchesFilter && matchesQuery) {
      for (const ancestorId of parentPath(node.id, input.nodes)) included.add(ancestorId);
    }
  }
  for (const nodeId of input.activePath) included.add(nodeId);
  included.add(input.snapshot.session.rootNodeId);
  return included;
}

export function buildDecisionTreeLayout(input: {
  snapshot: DecisionTreeSnapshot;
  collapsedNodeIds?: ReadonlySet<string>;
  expandedNodeIds?: ReadonlySet<string>;
  changedNodeIds?: ReadonlySet<string>;
  query?: string;
  filter?: DecisionTreeFilter;
}): DecisionTreeLayout {
  const nodes = new Map(input.snapshot.nodes.map((node) => [node.id, node]));
  const children = new Map<string, DecisionNodeProjection[]>();
  for (const node of input.snapshot.nodes) {
    if (!node.parentId || !nodes.has(node.parentId)) continue;
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  for (const siblings of children.values()) siblings.sort(compareNodes);
  const descendantCounts = buildDescendantCounts(input.snapshot.nodes, children);

  const activePath = parentPath(input.snapshot.session.activity.activeNodeId, nodes);
  const autoCollapsedNodeIds = new Set<string>();
  for (const node of input.snapshot.nodes) {
    if (
      node.id !== input.snapshot.session.rootNodeId &&
      !activePath.has(node.id) &&
      ["resolved", "delegated", "pruned"].includes(node.status) &&
      (descendantCounts.get(node.id) ?? 0) >= AUTO_COLLAPSE_DESCENDANT_THRESHOLD
    ) {
      autoCollapsedNodeIds.add(node.id);
    }
  }

  const included = buildIncludedNodes({
    snapshot: input.snapshot,
    nodes,
    query: input.query ?? "",
    filter: input.filter ?? "all",
    changedNodeIds: input.changedNodeIds ?? new Set(),
    activePath,
  });
  const manuallyCollapsed = input.collapsedNodeIds ?? new Set<string>();
  const manuallyExpanded = input.expandedNodeIds ?? new Set<string>();
  const filtered = (input.query?.trim().length ?? 0) > 0 || (input.filter ?? "all") !== "all";
  const isCollapsed = (nodeId: string) =>
    !activePath.has(nodeId) &&
    !(filtered && included.has(nodeId)) &&
    !manuallyExpanded.has(nodeId) &&
    (manuallyCollapsed.has(nodeId) || autoCollapsedNodeIds.has(nodeId));

  const positioned = new Map<string, DecisionTreeLayoutNode>();
  let nextLeafY = SCENE_PADDING;
  const visit = (node: DecisionNodeProjection, depth: number): number => {
    const collapsed = isCollapsed(node.id);
    const allChildren = children.get(node.id) ?? [];
    const visibleChildren = collapsed ? [] : allChildren.filter((child) => included.has(child.id));
    const childCenters = visibleChildren.map((child) => visit(child, depth + 1));
    const centerY =
      childCenters.length > 0
        ? (childCenters[0]! + childCenters[childCenters.length - 1]!) / 2
        : nextLeafY + NODE_HEIGHT / 2;
    if (childCenters.length === 0) nextLeafY += NODE_HEIGHT + ROW_GAP;
    positioned.set(node.id, {
      id: node.id,
      node,
      x: SCENE_PADDING + depth * (NODE_WIDTH + COLUMN_GAP),
      y: centerY - NODE_HEIGHT / 2,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      depth,
      collapsed,
      childCount: allChildren.length,
      hiddenDescendantCount: collapsed ? (descendantCounts.get(node.id) ?? 0) : 0,
    });
    return centerY;
  };

  const root = nodes.get(input.snapshot.session.rootNodeId);
  if (root) visit(root, 0);

  const layoutNodes = [...positioned.values()].sort(
    (left, right) =>
      left.depth - right.depth || left.y - right.y || left.id.localeCompare(right.id),
  );
  const edges = layoutNodes
    .filter((entry) => entry.node.parentId && positioned.has(entry.node.parentId))
    .map((entry) => ({ fromId: entry.node.parentId!, toId: entry.id }));
  const width = Math.max(1, ...layoutNodes.map((entry) => entry.x + entry.width + SCENE_PADDING));
  const height = Math.max(1, ...layoutNodes.map((entry) => entry.y + entry.height + SCENE_PADDING));
  return {
    nodes: layoutNodes,
    nodeById: positioned,
    edges,
    width,
    height,
    activePath,
    autoCollapsedNodeIds,
  };
}

export function buildDecisionTreeScene(input: {
  layout: DecisionTreeLayout;
  rootNodeId: string;
  includeTask: boolean;
}): DecisionTreeScene {
  if (!input.includeTask) {
    return {
      width: input.layout.width,
      height: input.layout.height,
      taskNode: null,
      taskConnector: [],
    };
  }
  const root = input.layout.nodeById.get(input.rootNodeId);
  if (!root) {
    return {
      width: input.layout.width,
      height: input.layout.height,
      taskNode: null,
      taskConnector: [],
    };
  }

  const taskNode: DecisionTreeTaskNode = {
    x: input.layout.width + TASK_GAP,
    y: Math.max(SCENE_PADDING, root.y + (root.height - TASK_HEIGHT) / 2),
    width: TASK_WIDTH,
    height: TASK_HEIGHT,
  };
  const start = { x: root.x + root.width, y: root.y + root.height / 2 };
  const rootExitX = start.x + COLUMN_GAP / 2;
  const safeLaneY = SCENE_PADDING / 2;
  const taskApproachX = taskNode.x - TASK_APPROACH_GAP;
  const taskCenterY = taskNode.y + taskNode.height / 2;
  return {
    width: taskNode.x + taskNode.width + SCENE_PADDING,
    height: Math.max(input.layout.height, taskNode.y + taskNode.height + SCENE_PADDING),
    taskNode,
    taskConnector: [
      start,
      { x: rootExitX, y: start.y },
      { x: rootExitX, y: safeLaneY },
      { x: taskApproachX, y: safeLaneY },
      { x: taskApproachX, y: taskCenterY },
      { x: taskNode.x, y: taskCenterY },
    ],
  };
}

export function decisionTreeNavigationTarget(
  layout: DecisionTreeLayout,
  currentNodeId: string,
  key: DecisionTreeNavigationKey,
): string | null {
  const current = layout.nodeById.get(currentNodeId);
  if (!current) return layout.nodes[0]?.id ?? null;
  if (key === "ArrowLeft") return current.node.parentId ?? current.id;
  if (key === "ArrowRight") {
    return (
      layout.nodes
        .filter((entry) => entry.node.parentId === current.id)
        .sort((left, right) => left.y - right.y || left.id.localeCompare(right.id))[0]?.id ??
      current.id
    );
  }

  const children = new Map<string, DecisionTreeLayoutNode[]>();
  for (const entry of layout.nodes) {
    if (!entry.node.parentId) continue;
    const siblings = children.get(entry.node.parentId) ?? [];
    siblings.push(entry);
    children.set(entry.node.parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((left, right) => left.y - right.y || left.id.localeCompare(right.id));
  }
  const root = layout.nodes.find((entry) => entry.node.parentId === null) ?? layout.nodes[0];
  if (!root) return null;
  const ordered: string[] = [];
  const visit = (entry: DecisionTreeLayoutNode) => {
    ordered.push(entry.id);
    for (const child of children.get(entry.id) ?? []) visit(child);
  };
  visit(root);
  const index = ordered.indexOf(current.id);
  const offset = key === "ArrowUp" ? -1 : 1;
  return ordered[clampIndex(index + offset, ordered.length)] ?? current.id;
}

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(Math.max(0, length - 1), index));
}

export function visibleDecisionTreeNodeIds(
  layout: DecisionTreeLayout,
  viewport: DecisionTreeViewport,
  overscan = 180,
): Set<string> {
  const scale = Math.max(0.01, viewport.scale);
  const left = (-viewport.panX - overscan) / scale;
  const top = (-viewport.panY - overscan) / scale;
  const right = (viewport.width - viewport.panX + overscan) / scale;
  const bottom = (viewport.height - viewport.panY + overscan) / scale;
  return new Set(
    layout.nodes
      .filter(
        (entry) =>
          entry.x + entry.width >= left &&
          entry.x <= right &&
          entry.y + entry.height >= top &&
          entry.y <= bottom,
      )
      .map((entry) => entry.id),
  );
}

export function fitDecisionTreeViewport(input: {
  layout: Pick<DecisionTreeLayout, "width" | "height">;
  width: number;
  height: number;
  padding?: number;
}): Pick<DecisionTreeViewport, "panX" | "panY" | "scale"> {
  const padding = input.padding ?? 28;
  const availableWidth = Math.max(1, input.width - padding * 2);
  const availableHeight = Math.max(1, input.height - padding * 2);
  const scale = Math.min(
    1,
    Math.max(
      0.002,
      Math.min(availableWidth / input.layout.width, availableHeight / input.layout.height),
    ),
  );
  return {
    scale,
    panX: padding,
    panY: padding,
  };
}

export function applyDecisionTreeDelta(
  snapshot: DecisionTreeSnapshot,
  delta: DecisionTreeDelta,
): DecisionTreeDeltaResult {
  if (snapshot.session.id !== delta.sessionId || snapshot.session.agentId !== delta.agentId) {
    return { kind: "unrelated", snapshot };
  }
  if (delta.revision <= snapshot.revision) return { kind: "stale", snapshot };
  if (delta.baseRevision !== snapshot.revision) return { kind: "gap", snapshot };

  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  for (const nodeId of delta.removedNodeIds) nodes.delete(nodeId);
  for (const node of delta.nodeUpserts) nodes.set(node.id, node);
  const receipts = new Map(snapshot.cardReceipts.map((receipt) => [receipt.cardId, receipt]));
  for (const receipt of delta.cardReceipts) receipts.set(receipt.cardId, receipt);
  return {
    kind: "applied",
    snapshot: {
      session: delta.session,
      nodes: [...nodes.values()],
      cardReceipts: [...receipts.values()],
      revision: delta.revision,
    },
  };
}
