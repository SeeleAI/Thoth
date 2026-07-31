import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { AgentTimelineItem } from "@thoth/protocol/agent-types";

type LegacyExecutionPlan = Extract<AgentTimelineItem, { type: "legacy_execution_plan" }>;

export function LegacyExecutionPlanCard({ plan }: { plan: LegacyExecutionPlan }) {
  return (
    <View style={styles.card} testID="legacy-execution-plan-card">
      <Text style={styles.kicker}>历史执行计划</Text>
      <Text style={styles.title}>{plan.title}</Text>
      <Text style={styles.summary}>{plan.summary}</Text>
      {plan.items.map((item, index) => (
        <View key={`${index}-${item.title}`} style={styles.item}>
          <Text style={styles.itemTitle}>{item.title}</Text>
          <Text style={styles.summary}>{item.objective}</Text>
          <Text style={styles.meta}>{item.outcome}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    gap: theme.spacing[3],
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
  item: {
    gap: theme.spacing[1],
    paddingTop: theme.spacing[2],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  itemTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  meta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
}));
