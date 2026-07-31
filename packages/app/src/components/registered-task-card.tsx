import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { TaskProjection } from "@thoth/protocol/task-authority";

export function RegisteredTaskCard({ task }: { task: TaskProjection }) {
  const currentWorkUnit = task.workUnits.find((workUnit) => workUnit.id === task.currentWorkUnitId);
  return (
    <View style={styles.card} testID="registered-task-card">
      <Text style={styles.kicker}>后台任务已注册</Text>
      <Text style={styles.title}>{task.title}</Text>
      <Text style={styles.summary}>{task.intentContract.objective}</Text>
      <Text style={styles.meta}>Task {task.id}</Text>
      <Text style={styles.meta}>{currentWorkUnit?.title ?? task.workingSet.activeGap}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    gap: theme.spacing[2],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  kicker: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  summary: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  meta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
}));
