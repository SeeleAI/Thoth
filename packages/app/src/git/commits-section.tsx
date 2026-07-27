import { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { useChangesPreferences } from "@/hooks/use-changes-preferences";
import { useCheckoutCommitsQuery, type ClassifiedCheckoutCommit } from "@/git/use-commits-query";
import { selectWorkspaceCommits } from "@/git/commits-section-state";
import { formatTimeAgo } from "@/utils/time";

const mutedIconColor = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);

function commitRowStyle({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.commitRow, (Boolean(hovered) || pressed) && styles.commitRowActive];
}

const CommitRow = memo(function CommitRow(props: {
  commit: ClassifiedCheckoutCommit;
  selected: boolean;
  onPress: (sha: string) => void;
}) {
  const handlePress = useCallback(() => props.onPress(props.commit.sha), [props]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      testID={`commit-row-${props.commit.shortSha}`}
      onPress={handlePress}
      style={commitRowStyle}
    >
      <View
        testID={props.commit.isOnRemote ? "commit-dot-remote" : "commit-dot-local"}
        style={[styles.commitDot, !props.commit.isOnRemote && styles.commitDotLocal]}
      />
      <Text style={styles.commitSha} numberOfLines={1}>
        {props.commit.shortSha}
      </Text>
      <Text
        style={[styles.commitSubject, props.selected && styles.commitSubjectSelected]}
        numberOfLines={1}
      >
        {props.commit.subject}
      </Text>
      <Text style={styles.commitTime}>{formatTimeAgo(new Date(props.commit.authorDate))}</Text>
      <ThemedChevronRight size={14} uniProps={mutedIconColor} />
    </Pressable>
  );
});

export function CommitsSection(props: {
  serverId: string;
  cwd: string;
  selectedSha: string | null;
  onCommitPress: (sha: string) => void;
}) {
  const { t } = useTranslation();
  const { preferences, updatePreferences } = useChangesPreferences();
  const collapsed = preferences.commitsCollapsed;
  const query = useCheckoutCommitsQuery({
    serverId: props.serverId,
    cwd: props.cwd,
    enabled: !collapsed,
  });
  const commits = useMemo(
    () => (query.status === "loaded" ? selectWorkspaceCommits(query.data.commits) : []),
    [query],
  );
  const toggle = useCallback(() => {
    void updatePreferences({ commitsCollapsed: !collapsed });
  }, [collapsed, updatePreferences]);

  if (query.status === "unsupported") return null;
  return (
    <View style={styles.container} testID="commits-section">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        testID="commits-section-header"
        onPress={toggle}
        style={styles.header}
      >
        {collapsed ? (
          <ThemedChevronRight size={14} uniProps={mutedIconColor} />
        ) : (
          <ThemedChevronDown size={14} uniProps={mutedIconColor} />
        )}
        <Text style={styles.title}>{t("workspace.git.diff.commits.title")}</Text>
        {query.status === "loaded" ? (
          <Text
            style={styles.count}
            accessibilityLabel={t("workspace.git.diff.commits.countLabel", {
              count: commits.length,
            })}
          >
            {commits.length}
          </Text>
        ) : null}
      </Pressable>
      {collapsed ? null : query.status === "error" ? (
        <Text style={styles.message} testID="commits-section-error">
          {t("workspace.git.diff.commits.loadError")}
        </Text>
      ) : query.status !== "loaded" ? (
        <Text style={styles.message} testID="commits-section-loading">
          {t("workspace.git.diff.commits.loading")}
        </Text>
      ) : commits.length === 0 ? (
        <Text style={styles.message} testID="commits-section-no-workspace-commits">
          {t("workspace.git.diff.commits.noneAhead", {
            baseRef: query.data.baseRef ?? t("workspace.git.diff.base"),
          })}
        </Text>
      ) : (
        <ScrollView style={styles.list} nestedScrollEnabled>
          {commits.map((commit) => (
            <CommitRow
              key={commit.sha}
              commit={commit}
              selected={commit.sha === props.selectedSha}
              onPress={props.onCommitPress}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flexShrink: 0,
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  header: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  count: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  list: { maxHeight: 220, paddingBottom: theme.spacing[1] },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  commitRow: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
  },
  commitRowActive: { backgroundColor: theme.colors.surfaceSidebarHover },
  commitDot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.accent,
  },
  commitDotLocal: { backgroundColor: theme.colors.surface0 },
  commitSha: {
    width: 62,
    flexShrink: 0,
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.xs,
  },
  commitSubject: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  commitSubjectSelected: { color: theme.colors.accent, fontWeight: "600" },
  commitTime: { flexShrink: 0, color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
}));
