import { useEffect, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeft, ListTodo } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { TasksSurface } from "@/panels/background-tasks-panel";
import { useBackgroundTasksSurfaceStore } from "@/stores/background-tasks-surface-store";
import { buildHostWorkspaceRoute, decodeWorkspaceIdFromPathSegment } from "@/utils/host-routes";

const ThemedArrowLeft = withUnistyles(ArrowLeft);
const ThemedListTodo = withUnistyles(ListTodo);

const mutedColorMapping = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});

function getParamValue(value: string | string[] | undefined): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const firstValue = value[0];
    return typeof firstValue === "string" ? firstValue.trim() : "";
  }
  return "";
}

export default function TasksRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <TasksRouteContent />
    </HostRouteBootstrapBoundary>
  );
}

function TasksRouteContent() {
  const params = useLocalSearchParams<{
    serverId?: string | string[];
    workspaceId?: string | string[];
  }>();
  const serverId = getParamValue(params.serverId);
  const workspaceValue = getParamValue(params.workspaceId);
  const workspaceId = useMemo(
    () => (workspaceValue ? (decodeWorkspaceIdFromPathSegment(workspaceValue) ?? "") : ""),
    [workspaceValue],
  );
  const openSurface = useBackgroundTasksSurfaceStore((state) => state.openSurface);

  useEffect(() => {
    if (!serverId || !workspaceId) {
      return;
    }
    openSurface({ serverId, workspaceId });
  }, [openSurface, serverId, workspaceId]);

  const handleBack = () => {
    router.replace(buildHostWorkspaceRoute(serverId, workspaceId));
  };

  if (!serverId || !workspaceId) {
    return null;
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to workspace"
          onPress={handleBack}
          style={styles.backButton}
          testID="tasks-mobile-back"
        >
          <ThemedArrowLeft size={20} uniProps={mutedColorMapping} />
        </Pressable>
        <View style={styles.titleGroup}>
          <ThemedListTodo size={18} uniProps={mutedColorMapping} />
          <Text style={styles.title}>Tasks</Text>
        </View>
      </View>
      <View style={styles.surface}>
        <TasksSurface serverId={serverId} workspaceId={workspaceId} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  header: {
    height: 48,
    paddingHorizontal: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  titleGroup: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  surface: {
    flex: 1,
    minHeight: 0,
  },
}));
