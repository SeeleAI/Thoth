import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Crosshair,
  GitBranch,
  Hand,
  Maximize2,
  Minus,
  Pin,
  Plus,
  Scissors,
  Search,
  Snowflake,
  X,
} from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import type {
  DecisionNodeProjection,
  DecisionSessionProjection,
  DecisionTreeActivityState,
  DecisionTreeDelta,
  DecisionTreeSnapshot,
} from "@thoth/protocol/clarify-authority";
import type {
  AgentThothPendingCard,
  ThothCardAnswerPayload,
} from "@thoth/protocol/thoth/rpc-schemas";
import { ClarifyDecisionCard } from "@/components/clarify-decision-card";
import { IntentContractCard } from "@/components/intent-contract-card";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useAuthorityProjection, useProjectionRuntime } from "@/projection/projection-context";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { generateMessageId } from "@/utils/message-id";
import {
  applyDecisionTreeDelta,
  buildDecisionTreeLayout,
  decisionTreeNavigationTarget,
  fitDecisionTreeViewport,
  visibleDecisionTreeNodeIds,
  type DecisionTreeFilter,
  type DecisionTreeLayout,
  type DecisionTreeLayoutNode,
  type DecisionTreeNavigationKey,
  type DecisionTreeViewport,
} from "./decision-tree-layout";

const MIN_PANEL_WIDTH = 360;
const DEFAULT_PANEL_WIDTH = 480;
const MAX_SCALE = 1.65;
const MIN_SCALE = 0.24;
const ACTIVE_ACTIVITY = new Set<DecisionTreeActivityState>([
  "understanding",
  "investigating",
  "expanding",
  "challenging",
]);

type IconComponent = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

interface ViewportSize {
  width: number;
  height: number;
}

interface DecisionTreeKeyboardEvent {
  key?: string;
  nativeEvent?: { key?: string };
  preventDefault: () => void;
}

const KeyboardPressable = Pressable as ComponentType<
  ComponentProps<typeof Pressable> & {
    onKeyDown?: (event: DecisionTreeKeyboardEvent) => void;
    tabIndex?: number;
  }
>;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function sessionLabel(session: DecisionSessionProjection, index: number): string {
  if (session.taskId) return `Task ${index + 1}`;
  if (session.lifecycle === "frozen") return `Decision ${index + 1}`;
  return `Current decision`;
}

function activityLabel(state: DecisionTreeActivityState): string {
  switch (state) {
    case "understanding":
      return "Understanding the objective";
    case "investigating":
      return "Checking workspace evidence";
    case "expanding":
      return "Expanding the decision tree";
    case "challenging":
      return "Checking for missing decisions";
    case "awaiting_human":
      return "Waiting for your decision";
    case "ready_to_confirm":
      return "Ready to confirm";
    case "frozen":
      return "Frozen as task evidence";
    case "blocked":
      return "Blocked";
  }
}

function nodeState(input: {
  node: DecisionNodeProjection;
  active: boolean;
  activity: DecisionTreeActivityState;
  frozen: boolean;
}): {
  label: string;
  icon: IconComponent | null;
  tone: "active" | "human" | "resolved" | "delegated" | "pruned" | "frozen" | "blocked";
  spinning: boolean;
} {
  if (input.frozen) {
    return { label: "Frozen", icon: Snowflake, tone: "frozen", spinning: false };
  }
  if (input.active && ACTIVE_ACTIVITY.has(input.activity)) {
    return { label: "Thoth is checking", icon: null, tone: "active", spinning: true };
  }
  if (input.active && input.activity === "blocked") {
    return { label: "Blocked", icon: AlertTriangle, tone: "blocked", spinning: false };
  }
  if (input.node.status === "awaiting_human" || input.node.status === "open") {
    return { label: "Needs your decision", icon: CircleHelp, tone: "human", spinning: false };
  }
  if (input.node.status === "delegated") {
    return { label: "Delegated", icon: Hand, tone: "delegated", spinning: false };
  }
  if (input.node.status === "pruned") {
    return { label: "Pruned", icon: Scissors, tone: "pruned", spinning: false };
  }
  return { label: "Confirmed", icon: Check, tone: "resolved", spinning: false };
}

function edgePath(from: DecisionTreeLayoutNode, to: DecisionTreeLayoutNode): string {
  const startX = from.x + from.width;
  const startY = from.y + from.height / 2;
  const endX = to.x;
  const endY = to.y + to.height / 2;
  const middleX = startX + (endX - startX) / 2;
  return `M ${startX} ${startY} C ${middleX} ${startY}, ${middleX} ${endY}, ${endX} ${endY}`;
}

function crossLinkPath(from: DecisionTreeLayoutNode, to: DecisionTreeLayoutNode): string {
  const startX = from.x + from.width / 2;
  const startY = from.y + from.height;
  const endX = to.x + to.width / 2;
  const endY = to.y;
  const middleY = startY + (endY - startY) / 2;
  return `M ${startX} ${startY} C ${startX} ${middleY}, ${endX} ${middleY}, ${endX} ${endY}`;
}

export function DecisionTreeSidebar({ serverId, agentId }: { serverId: string; agentId: string }) {
  const client = useHostRuntimeClient(serverId);
  const projectionRuntime = useProjectionRuntime();
  const compact = useIsCompactFormFactor();
  const window = useWindowDimensions();
  const thothState = useAuthorityProjection(
    serverId,
    (projection) => projection.agentThothStates.get(agentId) ?? null,
  );
  const [sessions, setSessions] = useState<DecisionSessionProjection[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<DecisionTreeSnapshot | null>(null);
  const [changedNodeIds, setChangedNodeIds] = useState<Set<string>>(new Set());
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locallyAnsweredCardId, setLocallyAnsweredCardId] = useState<string | null>(null);
  const snapshotRef = useRef<DecisionTreeSnapshot | null>(null);
  const selectedSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);
  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  const loadSnapshot = useCallback(
    async (sessionId?: string) => {
      if (!client) return null;
      const response = await client.getAgentDecisionSession({
        agentId,
        ...(sessionId ? { sessionId } : {}),
      });
      if (response.error) throw new Error(response.error);
      setSnapshot(response.snapshot);
      setSelectedSessionId(response.snapshot?.session.id ?? null);
      setChangedNodeIds(new Set());
      return response.snapshot;
    },
    [agentId, client],
  );

  const refresh = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    try {
      const response = await client.listAgentDecisionSessions(agentId);
      if (response.error) throw new Error(response.error);
      setSessions(response.sessions);
      const selectedStillExists = response.sessions.some(
        (session) => session.id === selectedSessionIdRef.current,
      );
      const preferredId =
        (selectedStillExists ? selectedSessionIdRef.current : null) ??
        response.activeSessionId ??
        response.sessions[0]?.id ??
        null;
      if (preferredId) await loadSnapshot(preferredId);
      else {
        setSnapshot(null);
        setSelectedSessionId(null);
      }
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }, [agentId, client, loadSnapshot]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const acceptDelta = useCallback(
    (delta: DecisionTreeDelta) => {
      if (delta.agentId !== agentId) return;
      const current = snapshotRef.current;
      setSessions((currentSessions) => {
        const exists = currentSessions.some((session) => session.id === delta.sessionId);
        return exists
          ? currentSessions.map((session) =>
              session.id === delta.sessionId ? delta.session : session,
            )
          : [delta.session, ...currentSessions];
      });
      if (!current) {
        if (!selectedSessionIdRef.current || selectedSessionIdRef.current === delta.sessionId) {
          void loadSnapshot(delta.sessionId).catch(() => undefined);
        }
        return;
      }
      if (current.session.id !== delta.sessionId) {
        return;
      }
      const result = applyDecisionTreeDelta(current, delta);
      if (result.kind === "gap") {
        void loadSnapshot(delta.sessionId).catch(() => undefined);
        return;
      }
      if (result.kind !== "applied") return;
      snapshotRef.current = result.snapshot;
      setSnapshot(result.snapshot);
      setChangedNodeIds(
        new Set([...delta.nodeUpserts.map((node) => node.id), ...delta.removedNodeIds]),
      );
      setError(null);
    },
    [agentId, loadSnapshot],
  );

  useEffect(() => {
    if (!client) return;
    return client.subscribeAgentDecisionTreeDeltas(acceptDelta);
  }, [acceptDelta, client]);

  const pendingCard = thothState?.pendingCard ?? null;
  useEffect(() => {
    if (!pendingCard) {
      setLocallyAnsweredCardId(null);
      return;
    }
    const cardSessionId = pendingCard.card.sessionId;
    if (cardSessionId !== selectedSessionIdRef.current) {
      void loadSnapshot(cardSessionId).catch(() => undefined);
    }
    if (compact) setVisible(true);
  }, [compact, loadSnapshot, pendingCard]);

  const answerCard = useCallback(
    async (answer: ThothCardAnswerPayload) => {
      if (!client || !pendingCard || !thothState || locallyAnsweredCardId) return;
      const cardId = pendingCard.card.id;
      try {
        const result = await client.answerAgentThothCard({
          agentId,
          cardId,
          answer,
          expectedRevision: thothState.revision,
          commandId: `decision_card_${generateMessageId()}`,
        });
        if (result.error || result.conflict || !result.accepted) {
          await refresh();
          setError(
            result.conflict
              ? "This decision was already handled on another device."
              : (result.error ?? "The decision could not be saved."),
          );
          return;
        }
        setLocallyAnsweredCardId(cardId);
        if (result.decisionTreeDelta) acceptDelta(result.decisionTreeDelta);
        await projectionRuntime
          .service(serverId)
          ?.refreshAgentThothState(agentId)
          .catch(() => undefined);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      }
    },
    [
      acceptDelta,
      agentId,
      client,
      locallyAnsweredCardId,
      pendingCard,
      projectionRuntime,
      refresh,
      serverId,
      thothState,
    ],
  );

  const selectSession = useCallback(
    async (sessionId: string) => {
      if (sessionId === selectedSessionIdRef.current) return;
      setLoading(true);
      try {
        await loadSnapshot(sessionId);
        setError(null);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      } finally {
        setLoading(false);
      }
    },
    [loadSnapshot],
  );

  if (!snapshot && !loading && !error) return null;

  const content = (
    <DecisionTreeContent
      agentId={agentId}
      answerCard={answerCard}
      error={error}
      loading={loading}
      locallyAnsweredCardId={locallyAnsweredCardId}
      pendingCard={pendingCard}
      sessions={sessions}
      selectedSessionId={selectedSessionId}
      selectSession={selectSession}
      snapshot={snapshot}
      changedNodeIds={changedNodeIds}
      client={client}
      acceptDelta={acceptDelta}
    />
  );

  if (compact) {
    return (
      <>
        <Pressable
          accessibilityLabel="Open decision tree"
          accessibilityRole="button"
          onPress={() => setVisible(true)}
          style={[styles.mobileLauncher, pendingCard && styles.mobileLauncherAttention]}
          testID="decision-tree-open"
        >
          {pendingCard ? <CircleHelp size={16} /> : <GitBranch size={16} />}
          <Text style={styles.mobileLauncherText}>
            {pendingCard ? "Decision needed" : "Decision tree"}
          </Text>
        </Pressable>
        <Modal
          animationType="slide"
          onRequestClose={() => setVisible(false)}
          presentationStyle="fullScreen"
          visible={visible}
        >
          <View style={styles.mobilePanel} testID="decision-tree-fullscreen">
            <Pressable
              accessibilityLabel="Close decision tree"
              accessibilityRole="button"
              onPress={() => setVisible(false)}
              style={styles.closeButton}
            >
              <X size={20} />
            </Pressable>
            {content}
          </View>
        </Modal>
      </>
    );
  }

  return (
    <ResizableDecisionTreePanel maxWidth={Math.max(MIN_PANEL_WIDTH, window.width * 0.55)}>
      {content}
    </ResizableDecisionTreePanel>
  );
}

function ResizableDecisionTreePanel({
  children,
  maxWidth,
}: {
  children: ReactNode;
  maxWidth: number;
}) {
  const reducedMotion = useReducedMotion();
  const width = useSharedValue(clamp(DEFAULT_PANEL_WIDTH, MIN_PANEL_WIDTH, maxWidth));
  const startWidth = useSharedValue(width.value);
  useEffect(() => {
    width.value = clamp(width.value, MIN_PANEL_WIDTH, maxWidth);
  }, [maxWidth, width]);
  const resizeGesture = useMemo(
    () =>
      Gesture.Pan()
        .onBegin(() => {
          startWidth.value = width.value;
        })
        .onUpdate((event) => {
          width.value = clamp(startWidth.value - event.translationX, MIN_PANEL_WIDTH, maxWidth);
        }),
    [maxWidth, startWidth, width],
  );
  const panelStyle = useAnimatedStyle(() => ({ width: width.value }));
  return (
    <Animated.View style={[animatedStyles.desktopPanel, panelStyle]} testID="decision-tree-sidebar">
      <GestureDetector gesture={resizeGesture} touchAction="none">
        <View
          accessibilityLabel="Resize decision tree"
          accessibilityRole="adjustable"
          style={styles.resizeHandle}
        />
      </GestureDetector>
      <View style={styles.desktopPanelPaint}>{children}</View>
      {reducedMotion ? null : <View pointerEvents="none" style={styles.panelEdge} />}
    </Animated.View>
  );
}

function DecisionTreeContent({
  agentId,
  answerCard,
  error,
  loading,
  locallyAnsweredCardId,
  pendingCard,
  sessions,
  selectedSessionId,
  selectSession,
  snapshot,
  changedNodeIds,
  client,
  acceptDelta,
}: {
  agentId: string;
  answerCard: (answer: ThothCardAnswerPayload) => Promise<void>;
  error: string | null;
  loading: boolean;
  locallyAnsweredCardId: string | null;
  pendingCard: AgentThothPendingCard | null;
  sessions: DecisionSessionProjection[];
  selectedSessionId: string | null;
  selectSession: (sessionId: string) => Promise<void>;
  snapshot: DecisionTreeSnapshot | null;
  changedNodeIds: ReadonlySet<string>;
  client: ReturnType<typeof useHostRuntimeClient>;
  acceptDelta: (delta: DecisionTreeDelta) => void;
}) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DecisionTreeFilter>("all");
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(new Set());
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set());
  const [prioritizing, setPrioritizing] = useState(false);
  const orderedSessions = useMemo(
    () => [...sessions].sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    [sessions],
  );
  const selectedSessionIndex = Math.max(
    0,
    orderedSessions.findIndex((session) => session.id === selectedSessionId),
  );

  useEffect(() => {
    if (!snapshot) return;
    setSelectedNodeId((current) =>
      current && snapshot.nodes.some((node) => node.id === current)
        ? current
        : (snapshot.session.activity.activeNodeId ?? snapshot.session.rootNodeId),
    );
  }, [snapshot]);

  const layout = useMemo(
    () =>
      snapshot
        ? buildDecisionTreeLayout({
            snapshot,
            collapsedNodeIds,
            expandedNodeIds,
            changedNodeIds,
            query,
            filter,
          })
        : null,
    [changedNodeIds, collapsedNodeIds, expandedNodeIds, filter, query, snapshot],
  );
  const selectedNode = snapshot?.nodes.find((node) => node.id === selectedNodeId) ?? null;

  const toggleCollapsed = useCallback((nodeId: string, currentlyCollapsed: boolean) => {
    if (currentlyCollapsed) {
      setCollapsedNodeIds((current) => {
        const next = new Set(current);
        next.delete(nodeId);
        return next;
      });
      setExpandedNodeIds((current) => new Set(current).add(nodeId));
      return;
    }
    setExpandedNodeIds((current) => {
      const next = new Set(current);
      next.delete(nodeId);
      return next;
    });
    setCollapsedNodeIds((current) => new Set(current).add(nodeId));
  }, []);

  const prioritize = useCallback(async () => {
    if (!client || !snapshot || !selectedNode || prioritizing) return;
    if (
      selectedNode.owner !== "human" ||
      !["open", "awaiting_human"].includes(selectedNode.status)
    ) {
      return;
    }
    setPrioritizing(true);
    try {
      const response = await client.prioritizeAgentDecisionNode({
        agentId,
        sessionId: snapshot.session.id,
        nodeId: selectedNode.id,
        expectedRevision: snapshot.revision,
        commandId: `decision_priority_${generateMessageId()}`,
      });
      if (response.delta) acceptDelta(response.delta);
    } finally {
      setPrioritizing(false);
    }
  }, [acceptDelta, agentId, client, prioritizing, selectedNode, snapshot]);

  return (
    <View style={styles.content}>
      <View style={styles.header}>
        <View style={styles.headerPrimary}>
          <View style={styles.titleRow}>
            <GitBranch size={17} />
            <Text style={styles.title}>Decision tree</Text>
            {loading ? <ActivityIndicator size="small" /> : null}
          </View>
          {snapshot ? (
            <Text style={styles.activity} numberOfLines={1}>
              {activityLabel(snapshot.session.activity.state)}
            </Text>
          ) : null}
        </View>
        {orderedSessions.length > 1 ? (
          <View style={styles.sessionControls}>
            <IconButton
              disabled={selectedSessionIndex <= 0}
              icon={ChevronLeft}
              label="Previous decision"
              onPress={() => {
                const previous = orderedSessions[selectedSessionIndex - 1];
                if (previous) void selectSession(previous.id);
              }}
            />
            <Text style={styles.sessionLabel} numberOfLines={1}>
              {sessionLabel(orderedSessions[selectedSessionIndex]!, selectedSessionIndex)} ·{" "}
              {selectedSessionIndex + 1}/{orderedSessions.length}
            </Text>
            <IconButton
              disabled={selectedSessionIndex >= orderedSessions.length - 1}
              icon={ChevronRight}
              label="Next decision"
              onPress={() => {
                const next = orderedSessions[selectedSessionIndex + 1];
                if (next) void selectSession(next.id);
              }}
            />
          </View>
        ) : null}
      </View>

      <View style={styles.searchRow}>
        <Search size={15} />
        <TextInput
          accessibilityLabel="Search decision tree"
          onChangeText={setQuery}
          placeholder="Find a decision"
          placeholderTextColor="#7b7f86"
          style={styles.searchInput}
          value={query}
        />
      </View>
      <View accessibilityRole="tablist" style={styles.filterBar}>
        <FilterButton active={filter === "all"} label="All" onPress={() => setFilter("all")} />
        <FilterButton
          active={filter === "needs_human"}
          label="Needs you"
          onPress={() => setFilter("needs_human")}
        />
        <FilterButton
          active={filter === "changed"}
          label="Changed"
          onPress={() => setFilter("changed")}
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {layout && snapshot ? (
        <DecisionTreeCanvas
          layout={layout}
          onSelectNode={setSelectedNodeId}
          onToggleCollapsed={toggleCollapsed}
          selectedNodeId={selectedNodeId}
          snapshot={snapshot}
        />
      ) : loading ? null : (
        <View style={styles.emptyState}>
          <GitBranch size={24} />
          <Text style={styles.emptyText}>No decision tree in this conversation yet.</Text>
        </View>
      )}

      <View style={styles.inspector}>
        {pendingCard && pendingCard.card.id !== locallyAnsweredCardId ? (
          <View style={styles.cardHost} testID="decision-tree-active-card">
            <ScrollView
              contentContainerStyle={styles.cardScrollContent}
              keyboardShouldPersistTaps="handled"
              style={styles.cardScroll}
            >
              {pendingCard.kind === "clarify_card" ? (
                <ClarifyDecisionCard card={pendingCard.card} onSubmit={answerCard} />
              ) : (
                <IntentContractCard card={pendingCard.card} onSubmit={answerCard} />
              )}
            </ScrollView>
          </View>
        ) : locallyAnsweredCardId ? (
          <View style={styles.receipt} testID="decision-tree-card-receipt">
            <Check size={16} />
            <View style={styles.receiptText}>
              <Text style={styles.inspectorTitle}>Decision saved</Text>
              <Text style={styles.inspectorSummary}>Thoth is updating the affected branch.</Text>
            </View>
          </View>
        ) : selectedNode ? (
          <NodeInspector
            node={selectedNode}
            onPrioritize={() => void prioritize()}
            prioritizing={prioritizing}
            snapshot={snapshot!}
          />
        ) : (
          <Text style={styles.inspectorSummary}>Select a node to inspect its decision record.</Text>
        )}
      </View>
    </View>
  );
}

function DecisionTreeCanvas({
  layout,
  onSelectNode,
  onToggleCollapsed,
  selectedNodeId,
  snapshot,
}: {
  layout: DecisionTreeLayout;
  onSelectNode: (nodeId: string) => void;
  onToggleCollapsed: (nodeId: string, collapsed: boolean) => void;
  selectedNodeId: string | null;
  snapshot: DecisionTreeSnapshot;
}) {
  const { theme } = useUnistyles();
  const reducedMotion = useReducedMotion();
  const [size, setSize] = useState<ViewportSize>({ width: 480, height: 320 });
  const [viewport, setViewport] = useState<DecisionTreeViewport>({
    width: 480,
    height: 320,
    panX: 20,
    panY: 20,
    scale: 1,
  });
  const panX = useSharedValue(20);
  const panY = useSharedValue(20);
  const scale = useSharedValue(1);
  const startPanX = useSharedValue(20);
  const startPanY = useSharedValue(20);
  const startScale = useSharedValue(1);
  const userBrowsing = useRef(false);
  const minimumScale = useMemo(
    () =>
      Math.min(
        MIN_SCALE,
        fitDecisionTreeViewport({ layout, width: size.width, height: size.height }).scale,
      ),
    [layout, size.height, size.width],
  );

  const commitViewport = useCallback(
    (nextPanX: number, nextPanY: number, nextScale: number) => {
      setViewport((current) => {
        const next = {
          width: size.width,
          height: size.height,
          panX: nextPanX,
          panY: nextPanY,
          scale: nextScale,
        };
        return current.width === next.width &&
          current.height === next.height &&
          Math.abs(current.panX - next.panX) < 0.01 &&
          Math.abs(current.panY - next.panY) < 0.01 &&
          Math.abs(current.scale - next.scale) < 0.001
          ? current
          : next;
      });
    },
    [size.height, size.width],
  );

  const moveTo = useCallback(
    (next: Pick<DecisionTreeViewport, "panX" | "panY" | "scale">) => {
      const duration = reducedMotion ? 0 : 220;
      panX.value = withTiming(next.panX, { duration, easing: Easing.out(Easing.cubic) });
      panY.value = withTiming(next.panY, { duration, easing: Easing.out(Easing.cubic) });
      scale.value = withTiming(next.scale, { duration, easing: Easing.out(Easing.cubic) });
      commitViewport(next.panX, next.panY, next.scale);
    },
    [commitViewport, panX, panY, reducedMotion, scale],
  );

  const fit = useCallback(() => {
    userBrowsing.current = false;
    moveTo(fitDecisionTreeViewport({ layout, width: size.width, height: size.height }));
  }, [layout, moveTo, size.height, size.width]);

  const focusActive = useCallback(() => {
    const active = snapshot.session.activity.activeNodeId
      ? layout.nodeById.get(snapshot.session.activity.activeNodeId)
      : null;
    if (!active) {
      fit();
      return;
    }
    userBrowsing.current = false;
    const nextScale = Math.max(0.72, Math.min(1, viewport.scale));
    moveTo({
      scale: nextScale,
      panX: size.width / 2 - (active.x + active.width / 2) * nextScale,
      panY: size.height / 2 - (active.y + active.height / 2) * nextScale,
    });
  }, [
    fit,
    layout.nodeById,
    moveTo,
    size.height,
    size.width,
    snapshot.session.activity.activeNodeId,
    viewport.scale,
  ]);

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const next = event.nativeEvent.layout;
      if (next.width <= 0 || next.height <= 0) return;
      setSize({ width: next.width, height: next.height });
      const fitted = fitDecisionTreeViewport({ layout, width: next.width, height: next.height });
      panX.value = fitted.panX;
      panY.value = fitted.panY;
      scale.value = fitted.scale;
      setViewport({ width: next.width, height: next.height, ...fitted });
    },
    [layout, panX, panY, scale],
  );

  useEffect(() => {
    if (userBrowsing.current || size.width <= 1 || size.height <= 1) return;
    focusActive();
  }, [focusActive, layout, size.height, size.width, snapshot.session.activity.activeNodeId]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(3)
        .onBegin(() => {
          startPanX.value = panX.value;
          startPanY.value = panY.value;
          runOnJS(() => {
            userBrowsing.current = true;
          })();
        })
        .onUpdate((event) => {
          panX.value = startPanX.value + event.translationX;
          panY.value = startPanY.value + event.translationY;
        })
        .onEnd(() => {
          runOnJS(commitViewport)(panX.value, panY.value, scale.value);
        }),
    [commitViewport, panX, panY, scale, startPanX, startPanY],
  );
  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onBegin(() => {
          startScale.value = scale.value;
          runOnJS(() => {
            userBrowsing.current = true;
          })();
        })
        .onUpdate((event) => {
          scale.value = clamp(startScale.value * event.scale, minimumScale, MAX_SCALE);
        })
        .onEnd(() => {
          runOnJS(commitViewport)(panX.value, panY.value, scale.value);
        }),
    [commitViewport, minimumScale, panX, panY, scale, startScale],
  );
  const gesture = useMemo(
    () => Gesture.Simultaneous(panGesture, pinchGesture),
    [panGesture, pinchGesture],
  );
  const sceneStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: panX.value }, { translateY: panY.value }, { scale: scale.value }],
  }));
  const visibleIds = useMemo(
    () => visibleDecisionTreeNodeIds(layout, viewport),
    [layout, viewport],
  );
  const compactLevelOfDetail = viewport.scale < 0.18;
  const selectedLayoutNode = selectedNodeId ? layout.nodeById.get(selectedNodeId) : null;
  const crossLinks = selectedLayoutNode
    ? selectedLayoutNode.node.crossLinkIds
        .map((id) => layout.nodeById.get(id))
        .filter((node): node is DecisionTreeLayoutNode => Boolean(node))
    : [];
  const sceneWidth = layout.width + (snapshot.session.taskId ? 236 : 0);
  const taskNode = snapshot.session.taskId
    ? {
        x: layout.width + 8,
        y: (layout.nodeById.get(snapshot.session.rootNodeId)?.y ?? 32) + 4,
        width: 196,
        height: 64,
      }
    : null;
  const root = layout.nodeById.get(snapshot.session.rootNodeId);

  const zoom = useCallback(
    (factor: number) => {
      userBrowsing.current = true;
      const nextScale = clamp(viewport.scale * factor, minimumScale, MAX_SCALE);
      const worldCenterX = (size.width / 2 - viewport.panX) / viewport.scale;
      const worldCenterY = (size.height / 2 - viewport.panY) / viewport.scale;
      moveTo({
        scale: nextScale,
        panX: size.width / 2 - worldCenterX * nextScale,
        panY: size.height / 2 - worldCenterY * nextScale,
      });
    },
    [minimumScale, moveTo, size.height, size.width, viewport.panX, viewport.panY, viewport.scale],
  );

  const navigate = useCallback(
    (key: DecisionTreeNavigationKey, sourceNodeId?: string) => {
      const currentId = sourceNodeId ?? selectedNodeId ?? snapshot.session.rootNodeId;
      const current = layout.nodeById.get(currentId);
      if (!current) return;
      if (key === "ArrowRight" && current.collapsed) {
        onToggleCollapsed(current.id, true);
        return;
      }
      if (key === "ArrowLeft" && current.childCount > 0 && !current.collapsed) {
        onToggleCollapsed(current.id, false);
        return;
      }
      const targetId = decisionTreeNavigationTarget(layout, currentId, key);
      const target = targetId ? layout.nodeById.get(targetId) : null;
      if (!targetId || !target) return;
      onSelectNode(targetId);
      userBrowsing.current = true;
      moveTo({
        scale: viewport.scale,
        panX: size.width / 2 - (target.x + target.width / 2) * viewport.scale,
        panY: size.height / 2 - (target.y + target.height / 2) * viewport.scale,
      });
    },
    [
      layout,
      moveTo,
      onSelectNode,
      onToggleCollapsed,
      selectedNodeId,
      size.height,
      size.width,
      snapshot.session.rootNodeId,
      viewport.scale,
    ],
  );

  return (
    <View onLayout={onLayout} style={styles.canvas} testID="decision-tree-canvas">
      <GestureDetector gesture={gesture} touchAction="none">
        <Animated.View
          style={[
            animatedStyles.scene,
            { width: sceneWidth, height: Math.max(layout.height, taskNode ? taskNode.y + 96 : 1) },
            sceneStyle,
          ]}
        >
          <Svg height={Math.max(layout.height, taskNode ? taskNode.y + 96 : 1)} width={sceneWidth}>
            {layout.edges.map((edge) => {
              const from = layout.nodeById.get(edge.fromId);
              const to = layout.nodeById.get(edge.toId);
              if (!from || !to) return null;
              const emphasized = layout.activePath.has(from.id) && layout.activePath.has(to.id);
              return (
                <Path
                  d={edgePath(from, to)}
                  fill="none"
                  key={`${edge.fromId}:${edge.toId}`}
                  stroke={emphasized ? theme.colors.accentBright : theme.colors.border}
                  strokeLinecap="round"
                  strokeWidth={emphasized ? 2.5 : 1.5}
                  testID={`decision-tree-edge-${edge.fromId}-${edge.toId}`}
                />
              );
            })}
            {selectedLayoutNode
              ? crossLinks.map((target) => (
                  <Path
                    d={crossLinkPath(selectedLayoutNode, target)}
                    fill="none"
                    key={`cross:${selectedLayoutNode.id}:${target.id}`}
                    stroke={theme.colors.statusWarning}
                    strokeDasharray="5 5"
                    strokeWidth={1.5}
                  />
                ))
              : null}
            {taskNode && root ? (
              <Path
                d={`M ${root.x + root.width} ${root.y + root.height / 2} C ${layout.width - 30} ${root.y + root.height / 2}, ${layout.width - 30} ${taskNode.y + taskNode.height / 2}, ${taskNode.x} ${taskNode.y + taskNode.height / 2}`}
                fill="none"
                stroke={theme.colors.accentBright}
                strokeDasharray="4 4"
                strokeWidth={2}
              />
            ) : null}
            {compactLevelOfDetail
              ? layout.nodes
                  .filter((entry) => visibleIds.has(entry.id))
                  .map((entry) => (
                    <Rect
                      fill={theme.colors.surface1}
                      height={entry.height}
                      key={`overview:${entry.id}`}
                      rx={6}
                      stroke={
                        snapshot.session.activity.activeNodeId === entry.id
                          ? theme.colors.accentBright
                          : theme.colors.border
                      }
                      strokeWidth={snapshot.session.activity.activeNodeId === entry.id ? 3 : 1.5}
                      width={entry.width}
                      x={entry.x}
                      y={entry.y}
                    />
                  ))
              : null}
          </Svg>

          {compactLevelOfDetail
            ? null
            : layout.nodes
                .filter((entry) => visibleIds.has(entry.id))
                .map((entry) => (
                  <DecisionTreeNodeView
                    active={snapshot.session.activity.activeNodeId === entry.id}
                    activity={snapshot.session.activity.state}
                    entry={entry}
                    frozen={snapshot.session.lifecycle === "frozen"}
                    key={entry.id}
                    onNavigate={navigate}
                    onPress={() => onSelectNode(entry.id)}
                    onToggleCollapsed={() => onToggleCollapsed(entry.id, entry.collapsed)}
                    selected={selectedNodeId === entry.id}
                    showSummary={viewport.scale >= 0.55}
                  />
                ))}
          {taskNode ? (
            <View
              style={[
                styles.taskLeaf,
                {
                  left: taskNode.x,
                  top: taskNode.y,
                  width: taskNode.width,
                  height: taskNode.height,
                },
              ]}
              testID="decision-tree-task-leaf"
            >
              <Pin size={16} />
              <View style={styles.taskLeafText}>
                <Text style={styles.taskLeafTitle}>Task registered</Text>
                <Text numberOfLines={1} style={styles.taskLeafId}>
                  {snapshot.session.taskId}
                </Text>
              </View>
            </View>
          ) : null}
        </Animated.View>
      </GestureDetector>

      <View style={styles.canvasToolbar}>
        <IconButton icon={Minus} label="Zoom out" onPress={() => zoom(0.82)} />
        <IconButton icon={Plus} label="Zoom in" onPress={() => zoom(1.22)} />
        <IconButton icon={Crosshair} label="Focus current decision" onPress={focusActive} />
        <IconButton icon={Maximize2} label="Fit entire tree" onPress={fit} />
      </View>
      <DecisionTreeMiniMap layout={layout} viewport={viewport} />
    </View>
  );
}

function DecisionTreeNodeView({
  active,
  activity,
  entry,
  frozen,
  onPress,
  onNavigate,
  onToggleCollapsed,
  selected,
  showSummary,
}: {
  active: boolean;
  activity: DecisionTreeActivityState;
  entry: DecisionTreeLayoutNode;
  frozen: boolean;
  onPress: () => void;
  onNavigate: (key: DecisionTreeNavigationKey, sourceNodeId: string) => void;
  onToggleCollapsed: () => void;
  selected: boolean;
  showSummary: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const x = useSharedValue(entry.x);
  const y = useSharedValue(entry.y);
  useEffect(() => {
    const duration = reducedMotion ? 0 : 240;
    x.value = withTiming(entry.x, { duration, easing: Easing.out(Easing.cubic) });
    y.value = withTiming(entry.y, { duration, easing: Easing.out(Easing.cubic) });
  }, [entry.x, entry.y, reducedMotion, x, y]);
  const positionStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }],
  }));
  const state = nodeState({ node: entry.node, active, activity, frozen });
  const StateIcon = state.icon;
  const hasChildren = entry.childCount > 0;
  return (
    <Animated.View
      style={[
        animatedStyles.nodePosition,
        { width: entry.width, height: entry.height },
        positionStyle,
      ]}
    >
      <View
        style={[
          styles.node,
          styles[`nodeTone_${state.tone}`],
          selected && styles.nodeSelected,
          active && styles.nodeActive,
        ]}
      >
        <KeyboardPressable
          accessibilityLabel={`${entry.node.title}. ${state.label}`}
          accessibilityHint={`Decision tree level ${entry.depth + 1}`}
          accessibilityRole="button"
          onFocus={onPress}
          onKeyDown={(event) => {
            const key = event.nativeEvent?.key ?? event.key;
            if (
              key !== "ArrowUp" &&
              key !== "ArrowDown" &&
              key !== "ArrowLeft" &&
              key !== "ArrowRight"
            ) {
              return;
            }
            event.preventDefault();
            onNavigate(key, entry.id);
          }}
          onPress={onPress}
          style={styles.nodeSelectArea}
          tabIndex={0}
          testID={`decision-tree-node-${entry.id}`}
        >
          <View style={styles.nodeHeader}>
            <View style={styles.nodeStatus}>
              {state.spinning ? (
                <ActivityIndicator
                  size="small"
                  testID={`decision-tree-node-activity-${entry.id}`}
                />
              ) : StateIcon ? (
                <StateIcon size={14} />
              ) : null}
              <Text numberOfLines={1} style={styles.nodeStatusText}>
                {state.label}
              </Text>
            </View>
          </View>
          <Text numberOfLines={2} style={styles.nodeTitle}>
            {entry.node.title}
          </Text>
          {showSummary && entry.node.summary ? (
            <Text numberOfLines={1} style={styles.nodeSummary}>
              {entry.node.summary}
            </Text>
          ) : null}
          {entry.collapsed && entry.hiddenDescendantCount > 0 ? (
            <Text style={styles.nodeCount}>{entry.hiddenDescendantCount} decisions folded</Text>
          ) : null}
        </KeyboardPressable>
        {hasChildren ? (
          <Pressable
            accessibilityLabel={entry.collapsed ? "Expand branch" : "Collapse branch"}
            accessibilityRole="button"
            hitSlop={8}
            onPress={onToggleCollapsed}
            style={styles.collapseButton}
          >
            {entry.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

function DecisionTreeMiniMap({
  layout,
  viewport,
}: {
  layout: DecisionTreeLayout;
  viewport: DecisionTreeViewport;
}) {
  const { theme } = useUnistyles();
  const width = 116;
  const height = 72;
  const scale = Math.min(width / Math.max(1, layout.width), height / Math.max(1, layout.height));
  const worldLeft = -viewport.panX / viewport.scale;
  const worldTop = -viewport.panY / viewport.scale;
  return (
    <View pointerEvents="none" style={styles.miniMap} testID="decision-tree-minimap">
      <Svg height={height} width={width}>
        {layout.nodes.map((entry) => (
          <Circle
            cx={(entry.x + entry.width / 2) * scale}
            cy={(entry.y + entry.height / 2) * scale}
            fill={
              layout.activePath.has(entry.id)
                ? theme.colors.accentBright
                : theme.colors.foregroundMuted
            }
            key={entry.id}
            r={layout.activePath.has(entry.id) ? 2 : 1.2}
          />
        ))}
        <Rect
          fill="transparent"
          height={(viewport.height / viewport.scale) * scale}
          stroke={theme.colors.foreground}
          strokeWidth={1}
          width={(viewport.width / viewport.scale) * scale}
          x={worldLeft * scale}
          y={worldTop * scale}
        />
      </Svg>
    </View>
  );
}

function NodeInspector({
  node,
  onPrioritize,
  prioritizing,
  snapshot,
}: {
  node: DecisionNodeProjection;
  onPrioritize: () => void;
  prioritizing: boolean;
  snapshot: DecisionTreeSnapshot;
}) {
  const canPrioritize = node.owner === "human" && ["open", "awaiting_human"].includes(node.status);
  return (
    <View style={styles.nodeInspector} testID="decision-tree-inspector">
      <View style={styles.inspectorHeading}>
        <Text numberOfLines={2} style={styles.inspectorTitle}>
          {node.title}
        </Text>
        <Text style={styles.inspectorMeta}>
          {node.owner} · {node.materiality} · {node.status}
        </Text>
      </View>
      {node.summary ? <Text style={styles.inspectorSummary}>{node.summary}</Text> : null}
      {node.sourceRefs.length > 0 ? (
        <Text numberOfLines={2} style={styles.inspectorSource}>
          Evidence: {node.sourceRefs.join(", ")}
        </Text>
      ) : null}
      {node.crossLinkIds.length > 0 ? (
        <Text style={styles.inspectorSource}>
          Also affects {node.crossLinkIds.length} decisions
        </Text>
      ) : null}
      {canPrioritize && snapshot.session.priorityNodeId !== node.id ? (
        <Pressable
          accessibilityRole="button"
          disabled={prioritizing}
          onPress={onPrioritize}
          style={styles.priorityButton}
          testID="decision-tree-prioritize"
        >
          {prioritizing ? <ActivityIndicator size="small" /> : <Pin size={14} />}
          <Text style={styles.priorityButtonText}>Discuss this branch next</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function IconButton({
  disabled = false,
  icon: Icon,
  label,
  onPress,
}: {
  disabled?: boolean;
  icon: IconComponent;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        pressed && styles.iconButtonPressed,
        disabled && styles.iconButtonDisabled,
      ]}
    >
      <Icon size={15} />
    </Pressable>
  );
}

function FilterButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.filterButton, active && styles.filterButtonActive]}
    >
      <Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text>
    </Pressable>
  );
}

const animatedStyles = StyleSheet.create({
  desktopPanel: {
    minWidth: MIN_PANEL_WIDTH,
    position: "relative",
  },
  scene: {
    position: "absolute",
    left: 0,
    top: 0,
    transformOrigin: "0 0",
  },
  nodePosition: {
    position: "absolute",
    left: 0,
    top: 0,
  },
});

const styles = StyleSheet.create((theme) => ({
  desktopPanelPaint: {
    flex: 1,
    minWidth: 0,
    borderLeftWidth: theme.borderWidth[1],
    borderLeftColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  resizeHandle: {
    position: "absolute",
    left: -4,
    top: 0,
    bottom: 0,
    width: 9,
    zIndex: 30,
  },
  panelEdge: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: theme.colors.borderAccent,
  },
  mobilePanel: {
    flex: 1,
    paddingTop: theme.spacing[6],
    backgroundColor: theme.colors.surface0,
  },
  mobileLauncher: {
    position: "absolute",
    top: theme.spacing[3],
    right: theme.spacing[3],
    zIndex: 12,
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  mobileLauncherAttention: {
    borderColor: theme.colors.statusWarning,
  },
  mobileLauncherText: { color: theme.colors.foreground, fontSize: theme.fontSize.xs },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-end",
    marginRight: theme.spacing[3],
  },
  content: { flex: 1, minHeight: 0 },
  header: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  headerPrimary: { flex: 1, minWidth: 0, gap: 3 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  activity: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  sessionControls: { flexDirection: "row", alignItems: "center", gap: 2, maxWidth: 180 },
  sessionLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs, maxWidth: 112 },
  searchRow: {
    height: 38,
    marginHorizontal: theme.spacing[3],
    marginTop: theme.spacing[3],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  filterBar: {
    marginHorizontal: theme.spacing[3],
    marginVertical: theme.spacing[2],
    flexDirection: "row",
    padding: 2,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  filterButton: {
    flex: 1,
    minHeight: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Math.max(2, theme.borderRadius.md - 2),
  },
  filterButtonActive: { backgroundColor: theme.colors.surface3 },
  filterText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  filterTextActive: { color: theme.colors.foreground, fontWeight: theme.fontWeight.medium },
  canvas: {
    flex: 1,
    minHeight: 180,
    overflow: "hidden",
    position: "relative",
    backgroundColor: theme.colors.surface0,
  },
  canvasToolbar: {
    position: "absolute",
    right: theme.spacing[3],
    top: theme.spacing[2],
    flexDirection: "row",
    padding: 2,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  iconButton: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Math.max(2, theme.borderRadius.md - 2),
  },
  iconButtonPressed: { backgroundColor: theme.colors.surface3 },
  iconButtonDisabled: { opacity: 0.3 },
  miniMap: {
    position: "absolute",
    right: theme.spacing[3],
    bottom: theme.spacing[3],
    width: 116,
    height: 72,
    overflow: "hidden",
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    opacity: 0.88,
  },
  node: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 6,
    backgroundColor: theme.colors.surface1,
  },
  nodeSelectArea: { flex: 1, minWidth: 0 },
  nodeTone_active: { borderColor: theme.colors.accentBright },
  nodeTone_human: { borderColor: theme.colors.statusWarning },
  nodeTone_resolved: { borderColor: theme.colors.statusSuccess },
  nodeTone_delegated: { borderColor: "#4c84d3" },
  nodeTone_pruned: { borderColor: theme.colors.border, opacity: 0.68 },
  nodeTone_frozen: { borderColor: theme.colors.foregroundMuted },
  nodeTone_blocked: { borderColor: theme.colors.statusDanger },
  nodeSelected: { borderWidth: 2, backgroundColor: theme.colors.surface2 },
  nodeActive: { shadowColor: theme.colors.accentBright, shadowOpacity: 0.22, shadowRadius: 8 },
  nodeHeader: {
    height: 17,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[1],
  },
  nodeStatus: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 5 },
  nodeStatusText: { flex: 1, color: theme.colors.foregroundMuted, fontSize: 10 },
  collapseButton: {
    position: "absolute",
    right: 5,
    top: 5,
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  nodeTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 17,
  },
  nodeSummary: { color: theme.colors.foregroundMuted, fontSize: 10, lineHeight: 13 },
  nodeCount: { color: theme.colors.foregroundMuted, fontSize: 10 },
  taskLeaf: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: 12,
    borderWidth: 2,
    borderColor: theme.colors.accentBright,
    borderRadius: 6,
    backgroundColor: theme.colors.surface2,
  },
  taskLeafText: { flex: 1, minWidth: 0 },
  taskLeafTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  taskLeafId: { color: theme.colors.foregroundMuted, fontSize: 10 },
  inspector: {
    maxHeight: "46%",
    minHeight: 104,
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  cardHost: { flex: 1, minHeight: 0 },
  cardScroll: { flex: 1, minHeight: 0 },
  cardScrollContent: { padding: theme.spacing[3] },
  receipt: {
    minHeight: 88,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  receiptText: { flex: 1, minWidth: 0, gap: 3 },
  nodeInspector: { padding: theme.spacing[4], gap: theme.spacing[2] },
  inspectorHeading: { gap: 2 },
  inspectorTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  inspectorMeta: { color: theme.colors.foregroundMuted, fontSize: 10 },
  inspectorSummary: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
  },
  inspectorSource: { color: theme.colors.foregroundMuted, fontSize: 10, lineHeight: 14 },
  priorityButton: {
    minHeight: 32,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  priorityButtonText: { color: theme.colors.foreground, fontSize: theme.fontSize.xs },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.xs,
    paddingHorizontal: theme.spacing[3],
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[6],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
