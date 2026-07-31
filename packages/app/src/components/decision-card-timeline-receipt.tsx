import { Check, CircleHelp, X } from "lucide-react-native";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

export function DecisionCardTimelineReceipt({
  active,
  canceled = false,
  summary,
  title,
}: {
  active: boolean;
  canceled?: boolean;
  summary?: string | null;
  title: string;
}) {
  const Icon = active ? CircleHelp : canceled ? X : Check;
  return (
    <View
      accessibilityLabel={`${title}. ${active ? "Waiting for your decision" : canceled ? "Closed" : "Decision recorded"}`}
      style={styles.row}
      testID="decision-card-timeline-receipt"
    >
      <View style={[styles.icon, active && styles.iconActive, canceled && styles.iconCanceled]}>
        <Icon size={14} />
      </View>
      <View style={styles.text}>
        <Text numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        <Text numberOfLines={2} style={styles.summary}>
          {active
            ? "Waiting in the decision tree"
            : (summary ?? (canceled ? "Decision closed" : "Decision recorded"))}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    width: "100%",
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  icon: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.statusSuccess,
    backgroundColor: theme.colors.surface1,
  },
  iconActive: { borderColor: theme.colors.statusWarning },
  iconCanceled: { borderColor: theme.colors.border },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  summary: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
}));
