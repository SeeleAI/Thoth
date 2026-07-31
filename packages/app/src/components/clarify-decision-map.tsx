import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, Text, View } from "react-native";
import { GitBranch, X } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import type {
  ClarifyDecisionNodeProjection,
  ClarifySessionProjection,
} from "@thoth/protocol/clarify-authority";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { generateMessageId } from "@/utils/message-id";

interface TreeNode {
  node: ClarifyDecisionNodeProjection;
  depth: number;
  additionalParentCount: number;
}

function flattenDecisionMap(nodes: ClarifyDecisionNodeProjection[]): TreeNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, ClarifyDecisionNodeProjection[]>();
  const roots: ClarifyDecisionNodeProjection[] = [];

  for (const node of nodes) {
    const primaryParentId = node.parentIds.find((parentId) => byId.has(parentId));
    if (!primaryParentId) {
      roots.push(node);
      continue;
    }
    const siblings = children.get(primaryParentId) ?? [];
    siblings.push(node);
    children.set(primaryParentId, siblings);
  }

  const byPriority = (left: ClarifyDecisionNodeProjection, right: ClarifyDecisionNodeProjection) =>
    right.priority - left.priority || left.title.localeCompare(right.title);
  roots.sort(byPriority);
  for (const siblings of children.values()) siblings.sort(byPriority);

  const result: TreeNode[] = [];
  const visited = new Set<string>();
  const visit = (node: ClarifyDecisionNodeProjection, depth: number) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    const knownParents = node.parentIds.filter((parentId) => byId.has(parentId)).length;
    result.push({ node, depth, additionalParentCount: Math.max(0, knownParents - 1) });
    for (const child of children.get(node.id) ?? []) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  for (const node of nodes.toSorted(byPriority)) visit(node, 0);
  return result;
}

function nodeCanBePrioritized(node: ClarifyDecisionNodeProjection): boolean {
  return node.owner === "human" && (node.status === "open" || node.status === "awaiting_human");
}

export function ClarifyDecisionMap({ serverId, agentId }: { serverId: string; agentId: string }) {
  const client = useHostRuntimeClient(serverId);
  const compact = useIsCompactFormFactor();
  const [session, setSession] = useState<ClarifySessionProjection | null>(null);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [prioritizingNodeId, setPrioritizingNodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    try {
      const response = await client.getAgentClarifySession(agentId);
      if (response.error) throw new Error(response.error);
      setSession(response.session);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }, [agentId, client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!client) return;
    return client.subscribeAgentClarifySessionUpdates((update) => {
      if (update.agentId === agentId) void refresh();
    });
  }, [agentId, client, refresh]);

  const rows = useMemo(() => flattenDecisionMap(session?.nodes ?? []), [session?.nodes]);

  const prioritize = useCallback(
    async (node: ClarifyDecisionNodeProjection) => {
      if (!client || !session || !nodeCanBePrioritized(node) || prioritizingNodeId) return;
      setPrioritizingNodeId(node.id);
      try {
        const response = await client.prioritizeAgentClarifyNode({
          agentId,
          sessionId: session.id,
          nodeId: node.id,
          expectedRevision: session.revision,
          commandId: `clarify_priority_${generateMessageId()}`,
        });
        if (response.error || response.conflict || !response.session) {
          throw new Error(response.error ?? "Decision Map changed on another client");
        }
        setSession(response.session);
        setError(null);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
        await refresh();
      } finally {
        setPrioritizingNodeId(null);
      }
    },
    [agentId, client, prioritizingNodeId, refresh, session],
  );

  if (!session && !loading && !error) return null;

  const content = (
    <DecisionMapContent
      session={session}
      rows={rows}
      loading={loading}
      error={error}
      prioritizingNodeId={prioritizingNodeId}
      onPrioritize={prioritize}
    />
  );

  if (!compact) {
    return (
      <View style={styles.desktopPanel} testID="clarify-decision-map">
        {content}
      </View>
    );
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open Decision Map"
        onPress={() => setVisible(true)}
        style={styles.mobileLauncher}
        testID="clarify-decision-map-open"
      >
        <GitBranch size={16} />
        <Text style={styles.mobileLauncherText}>Decision Map</Text>
      </Pressable>
      <Modal
        animationType="slide"
        onRequestClose={() => setVisible(false)}
        presentationStyle="fullScreen"
        visible={visible}
      >
        <View style={styles.mobilePanel} testID="clarify-decision-map-fullscreen">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close Decision Map"
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

function DecisionMapContent({
  session,
  rows,
  loading,
  error,
  prioritizingNodeId,
  onPrioritize,
}: {
  session: ClarifySessionProjection | null;
  rows: TreeNode[];
  loading: boolean;
  error: string | null;
  prioritizingNodeId: string | null;
  onPrioritize: (node: ClarifyDecisionNodeProjection) => void;
}) {
  return (
    <View style={styles.content}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Decision Map</Text>
          <Text style={styles.subtitle}>
            {session ? `${session.lifecycle} | revision ${session.revision}` : "Unavailable"}
          </Text>
        </View>
        {loading ? <ActivityIndicator size="small" /> : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={rows}
        keyExtractor={(entry) => entry.node.id}
        initialNumToRender={30}
        maxToRenderPerBatch={30}
        windowSize={7}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          loading ? null : <Text style={styles.empty}>Decision Map has no visible nodes yet.</Text>
        }
        renderItem={({ item }) => {
          const canPrioritize = nodeCanBePrioritized(item.node);
          const isPriority = session?.priorityNodeId === item.node.id;
          return (
            <Pressable
              accessibilityRole={canPrioritize ? "button" : undefined}
              accessibilityLabel={canPrioritize ? `Prioritize ${item.node.title}` : undefined}
              disabled={!canPrioritize || prioritizingNodeId !== null}
              onPress={() => onPrioritize(item.node)}
              style={[
                styles.node,
                { marginLeft: Math.min(item.depth * 14, 84) },
                isPriority && styles.nodePriority,
              ]}
              testID={`clarify-decision-node-${item.node.id}`}
            >
              <View style={styles.nodeHeader}>
                <Text style={styles.nodeTitle}>{item.node.title}</Text>
                {prioritizingNodeId === item.node.id ? <ActivityIndicator size="small" /> : null}
              </View>
              <Text style={styles.nodeMeta}>
                {item.node.owner} | {item.node.materiality} | {item.node.status}
                {item.additionalParentCount > 0
                  ? ` | +${item.additionalParentCount} parent${item.additionalParentCount > 1 ? "s" : ""}`
                  : ""}
              </Text>
              {item.node.sourceRefs.length > 0 ? (
                <Text style={styles.nodeSource} numberOfLines={2}>
                  Sources: {item.node.sourceRefs.join(", ")}
                </Text>
              ) : null}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  desktopPanel: {
    width: 340,
    minWidth: 280,
    maxWidth: 400,
    borderLeftWidth: theme.borderWidth[1],
    borderLeftColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
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
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  headerText: { flex: 1, minWidth: 0, gap: 2 },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  subtitle: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  list: { padding: theme.spacing[3], gap: theme.spacing[2] },
  node: {
    gap: theme.spacing[1],
    padding: theme.spacing[2],
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  nodePriority: { borderLeftColor: theme.colors.accentBright },
  nodeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  nodeTitle: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  nodeMeta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  nodeSource: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.xs,
    padding: theme.spacing[3],
  },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[4],
    textAlign: "center",
  },
}));
