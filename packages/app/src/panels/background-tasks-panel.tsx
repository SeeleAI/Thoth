import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import {
  CheckCircle2,
  Clock3,
  ListTodo,
  Pause,
  Play,
  RefreshCw,
  Square,
  XCircle,
} from "lucide-react-native";
import type {
  ExecutionProjection,
  HumanDecisionRecord,
  TaskCommand,
  TaskProjection,
} from "@thoth/protocol/task-authority";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ResizeHandle } from "@/components/resize-handle";
import { isWeb } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import {
  buildBackgroundTasksSurfaceKey,
  clampBackgroundTasksListWidth,
  shouldStackBackgroundTasksSurface,
  useBackgroundTasksSurfaceStore,
} from "@/stores/background-tasks-surface-store";

const BACKGROUND_TASKS_NARROW_DETAIL_HEADER_WIDTH = 520;
const TIMELINE_PAGE_SIZE = 200;

const ThemedListTodo = withUnistyles(ListTodo);
const ThemedCheckCircle = withUnistyles(CheckCircle2);
const ThemedXCircle = withUnistyles(XCircle);

const mutedColorMapping = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});

const successColorMapping = (theme: { colors: { accentBright: string } }) => ({
  color: theme.colors.accentBright,
});

const dangerColorMapping = (theme: { colors: { destructive: string } }) => ({
  color: theme.colors.destructive,
});

interface ScrollMetrics {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}

const SCROLL_EDGE_EPSILON = 1;

function canScrollWithDelta(metrics: ScrollMetrics | null, deltaY: number): boolean {
  if (!metrics || deltaY === 0) {
    return false;
  }
  const maxScrollTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
  if (maxScrollTop <= SCROLL_EDGE_EPSILON) {
    return false;
  }
  return deltaY > 0
    ? metrics.scrollTop < maxScrollTop - SCROLL_EDGE_EPSILON
    : metrics.scrollTop > SCROLL_EDGE_EPSILON;
}

export function shouldForwardLoopPhaseTimelineWheel(input: {
  deltaY: number;
  inner: ScrollMetrics | null;
  outer: ScrollMetrics | null;
}): boolean {
  return (
    input.deltaY !== 0 &&
    !canScrollWithDelta(input.inner, input.deltaY) &&
    canScrollWithDelta(input.outer, input.deltaY)
  );
}

function taskStatusLabel(status: TaskProjection["status"]): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "awaiting_user":
      return "Decision needed";
    case "paused":
      return "Paused";
    case "stopping":
      return "Canceling";
    case "stopped":
      return "Stopped";
    case "budget_wait":
      return "Budget wait";
    case "blocked":
      return "Blocked";
    case "completed":
      return "Done";
    case "interrupted":
      return "Interrupted";
  }
}

function executionStatusLabel(status: ExecutionProjection["status"]): string {
  switch (status) {
    case "awaiting_provider":
      return "Waiting for provider";
    case "cancel_requested":
      return "Canceling";
    case "canceled":
      return "Canceled";
    case "succeeded":
      return "Completed";
    case "orphaned":
      return "Stopped, provider quarantined";
    default:
      return status.replaceAll("_", " ");
  }
}

function isExecutionBusy(execution: ExecutionProjection | null): boolean {
  return (
    execution !== null &&
    ["created", "starting", "planning", "implementing", "running", "awaiting_provider"].includes(
      execution.status,
    )
  );
}

function approvalCountdownLabel(deadlineAt: string | null, now: number): string {
  if (!deadlineAt) {
    return "Waiting for a decision";
  }
  const remainingMs = Date.parse(deadlineAt) - now;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return "Automatic approval is being committed";
  }
  return `Automatic approval in ${Math.ceil(remainingMs / 1000)}s`;
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "Not started";
  }
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m ${seconds}s`;
}

function useElapsedTick(enabled: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

function commandId(taskId: string, revision: number, action: string): string {
  return `${taskId}:${revision}:${action}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function timelineText(item: unknown): string {
  if (typeof item === "string") {
    return item;
  }
  if (item && typeof item === "object") {
    for (const key of ["text", "message", "summary", "content"] as const) {
      const value = (item as Record<string, unknown>)[key];
      if (typeof value === "string") {
        return value;
      }
    }
  }
  try {
    return JSON.stringify(item, null, 2);
  } catch {
    return String(item);
  }
}

function ActionButton({
  testID,
  label,
  icon,
  disabled,
  onPress,
}: {
  testID: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={[styles.actionButton, disabled && styles.actionButtonDisabled]}
    >
      {icon}
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

export function BackgroundTasksSurface({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}) {
  const client = useHostRuntimeClient(serverId);
  const surfaceKey = buildBackgroundTasksSurfaceKey({ serverId, workspaceId });
  const persistedSurface = useBackgroundTasksSurfaceStore(
    (state) => state.byWorkspaceKey[surfaceKey],
  );
  const updateSurface = useBackgroundTasksSurfaceStore((state) => state.updateSurface);
  const isCompactLayout = useIsCompactFormFactor();
  const [tasks, setTasks] = useState<TaskProjection[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(
    () => persistedSurface?.selectedTaskId ?? null,
  );
  const [selectedTask, setSelectedTask] = useState<TaskProjection | null>(null);
  const [executions, setExecutions] = useState<ExecutionProjection[]>([]);
  const [decisions, setDecisions] = useState<HumanDecisionRecord[]>([]);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(
    () => persistedSurface?.selectedGoalId ?? null,
  );
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(
    () => persistedSurface?.selectedExecutionId ?? null,
  );
  const [timeline, setTimeline] = useState<
    Array<{ seq: number; occurredAt: string; item: unknown }>
  >([]);
  const [nextBeforeSeq, setNextBeforeSeq] = useState<number | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [pendingAction, setPendingAction] = useState<TaskCommand | "decision" | "approval" | null>(
    null,
  );
  const [decisionChoiceId, setDecisionChoiceId] = useState<string | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [surfaceWidth, setSurfaceWidth] = useState(0);

  const selectedExecution = useMemo(
    () => executions.find((execution) => execution.id === selectedExecutionId) ?? null,
    [executions, selectedExecutionId],
  );
  const approvalExecution = useMemo(
    () => executions.find((execution) => execution.pendingApproval !== null) ?? null,
    [executions],
  );
  const pendingApproval = approvalExecution?.pendingApproval ?? null;
  const now = useElapsedTick(isExecutionBusy(selectedExecution) || pendingApproval !== null);
  const taskListWidth = useMemo(
    () => clampBackgroundTasksListWidth(persistedSurface?.taskListWidth, surfaceWidth),
    [persistedSurface?.taskListWidth, surfaceWidth],
  );
  const useStackedLayout = shouldStackBackgroundTasksSurface({
    isCompact: isCompactLayout,
    surfaceWidth,
  });
  const useNarrowDetailHeader =
    useStackedLayout ||
    (surfaceWidth > 0 &&
      surfaceWidth - taskListWidth < BACKGROUND_TASKS_NARROW_DETAIL_HEADER_WIDTH);
  const taskListResizeSizes = useMemo(() => {
    if (surfaceWidth <= 0) {
      return [0.36, 0.64];
    }
    const left = Math.min(0.8, Math.max(0.1, taskListWidth / surfaceWidth));
    return [left, 1 - left];
  }, [surfaceWidth, taskListWidth]);

  const refreshList = useCallback(async () => {
    if (!client) {
      return;
    }
    const response = await client.listTasks(workspaceId);
    if (response.error) {
      setError(response.error);
      return;
    }
    setTasks(response.tasks);
    setSelectedTaskId((current) => {
      if (current && response.tasks.some((task) => task.id === current)) {
        return current;
      }
      return response.tasks[0]?.id ?? null;
    });
  }, [client, workspaceId]);

  const refreshDetail = useCallback(
    async (taskId: string) => {
      if (!client) {
        return;
      }
      const response = await client.getTask({ workspaceId, taskId });
      if (response.error || !response.task) {
        setError(response.error ?? `Task ${taskId} was not found`);
        return;
      }
      setError(null);
      setSelectedTask(response.task);
      setExecutions(response.executions);
      setDecisions(response.decisions);
      setSelectedGoalId((current) =>
        current && response.task!.goals.some((goal) => goal.id === current)
          ? current
          : (response.task!.currentGoalId ?? response.task!.goals[0]?.id ?? null),
      );
      setSelectedExecutionId((current) => {
        if (current && response.executions.some((execution) => execution.id === current)) {
          return current;
        }
        return (
          response.task!.currentExecutionId ??
          response.executions.toSorted((left, right) =>
            (right.startedAt ?? right.lastActivityAt ?? "").localeCompare(
              left.startedAt ?? left.lastActivityAt ?? "",
            ),
          )[0]?.id ??
          null
        );
      });
    },
    [client, workspaceId],
  );

  useEffect(() => {
    void refreshList().catch((nextError) =>
      setError(nextError instanceof Error ? nextError.message : String(nextError)),
    );
  }, [refreshList]);

  useEffect(() => {
    if (!selectedTaskId) {
      setSelectedTask(null);
      setExecutions([]);
      setDecisions([]);
      return;
    }
    void refreshDetail(selectedTaskId).catch((nextError) =>
      setError(nextError instanceof Error ? nextError.message : String(nextError)),
    );
  }, [refreshDetail, selectedTaskId]);

  useEffect(() => {
    if (!client) {
      return;
    }
    return client.subscribeWorkspaceAuthorityUpdates((update) => {
      if (update.workspaceId !== workspaceId) {
        return;
      }
      void refreshList();
      if (
        selectedTaskId &&
        (update.changedTaskIds.includes(selectedTaskId) || update.changedExecutionIds.length > 0)
      ) {
        void refreshDetail(selectedTaskId);
      }
    });
  }, [client, refreshDetail, refreshList, selectedTaskId, workspaceId]);

  useEffect(() => {
    updateSurface({
      serverId,
      workspaceId,
      selectedTaskId,
      selectedGoalId,
      selectedExecutionId,
    });
  }, [selectedExecutionId, selectedGoalId, selectedTaskId, serverId, updateSurface, workspaceId]);

  useEffect(() => {
    setDecisionChoiceId(null);
    setDecisionNote("");
  }, [selectedTask?.pendingDecision?.id]);

  useEffect(() => {
    if (!client || !selectedTask || !selectedExecutionId) {
      setTimeline([]);
      setNextBeforeSeq(null);
      return;
    }
    let active = true;
    setTimelineLoading(true);
    void client
      .getExecutionTimeline({
        workspaceId,
        taskId: selectedTask.id,
        executionId: selectedExecutionId,
        limit: TIMELINE_PAGE_SIZE,
      })
      .then((response) => {
        if (!active) {
          return;
        }
        if (response.error) {
          setError(response.error);
          setTimeline([]);
          setNextBeforeSeq(null);
        } else {
          setTimeline(response.entries);
          setNextBeforeSeq(response.nextBeforeSeq);
        }
      })
      .catch((nextError) => {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      })
      .finally(() => {
        if (active) {
          setTimelineLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [client, selectedExecutionId, selectedTask, workspaceId]);

  const loadEarlier = useCallback(async () => {
    if (!client || !selectedTask || !selectedExecutionId || !nextBeforeSeq || loadingEarlier) {
      return;
    }
    setLoadingEarlier(true);
    try {
      const response = await client.getExecutionTimeline({
        workspaceId,
        taskId: selectedTask.id,
        executionId: selectedExecutionId,
        beforeSeq: nextBeforeSeq,
        limit: TIMELINE_PAGE_SIZE,
      });
      if (response.error) {
        setError(response.error);
      } else {
        setTimeline((current) => [...response.entries, ...current]);
        setNextBeforeSeq(response.nextBeforeSeq);
      }
    } finally {
      setLoadingEarlier(false);
    }
  }, [client, loadingEarlier, nextBeforeSeq, selectedExecutionId, selectedTask, workspaceId]);

  const handleTaskAction = useCallback(
    async (action: TaskCommand) => {
      if (!client || !selectedTask) {
        return;
      }
      setPendingAction(action);
      try {
        const response = await client.commandTask({
          workspaceId,
          taskId: selectedTask.id,
          command: action,
          expectedRevision: selectedTask.revision,
          commandId: commandId(selectedTask.id, selectedTask.revision, action),
        });
        if (response.conflict) {
          setError("任务状态已被另一端更新");
          await refreshDetail(selectedTask.id);
          return;
        }
        if (response.error) {
          setError(response.error);
        }
        if (response.task) {
          setSelectedTask(response.task);
        }
        await refreshList();
      } finally {
        setPendingAction(null);
      }
    },
    [client, refreshDetail, refreshList, selectedTask, workspaceId],
  );

  const handleDecision = useCallback(async () => {
    const pending = selectedTask?.pendingDecision;
    if (!client || !selectedTask || !pending || !decisionChoiceId) {
      return;
    }
    setPendingAction("decision");
    try {
      const response = await client.answerTaskDecision({
        workspaceId,
        taskId: selectedTask.id,
        decisionId: pending.id,
        optionId: decisionChoiceId,
        ...(decisionNote.trim() ? { note: decisionNote.trim() } : {}),
        expectedRevision: selectedTask.revision,
        commandId: commandId(selectedTask.id, selectedTask.revision, "decision"),
      });
      if (response.conflict) {
        setError("任务状态已被另一端更新");
      } else if (response.error) {
        setError(response.error);
      }
      await refreshDetail(selectedTask.id);
      await refreshList();
    } finally {
      setPendingAction(null);
    }
  }, [
    client,
    decisionChoiceId,
    decisionNote,
    refreshDetail,
    refreshList,
    selectedTask,
    workspaceId,
  ]);

  const handleExecutionApproval = useCallback(
    async (decision: "allow" | "deny" | "implement") => {
      if (!client || !selectedTask || !approvalExecution || !pendingApproval) {
        return;
      }
      setPendingAction("approval");
      try {
        const response = await client.resolveExecutionApproval({
          workspaceId,
          taskId: selectedTask.id,
          executionId: approvalExecution.id,
          approvalId: pendingApproval.id,
          decision,
          expectedRevision: pendingApproval.revision,
          commandId: commandId(pendingApproval.id, pendingApproval.revision, decision),
        });
        if (response.conflict) {
          setError("该审批已由另一端或自动审批处理");
        } else if (response.error) {
          setError(response.error);
        } else {
          setError(null);
        }
        await refreshDetail(selectedTask.id);
        await refreshList();
      } finally {
        setPendingAction(null);
      }
    },
    [
      approvalExecution,
      client,
      pendingApproval,
      refreshDetail,
      refreshList,
      selectedTask,
      workspaceId,
    ],
  );

  const selectedGoal = useMemo(
    () => selectedTask?.goals.find((goal) => goal.id === selectedGoalId) ?? null,
    [selectedGoalId, selectedTask],
  );
  const visibleExecutions = useMemo(
    () =>
      executions
        .filter((execution) => !selectedGoal || execution.goalId === selectedGoal.id)
        .toSorted((left, right) =>
          (right.startedAt ?? right.lastActivityAt ?? "").localeCompare(
            left.startedAt ?? left.lastActivityAt ?? "",
          ),
        ),
    [executions, selectedGoal],
  );
  const busyExecution = selectedTask?.currentExecutionId
    ? (executions.find((execution) => execution.id === selectedTask.currentExecutionId) ?? null)
    : null;
  const elapsed =
    selectedExecution?.startedAt && isExecutionBusy(selectedExecution)
      ? formatDuration(now - new Date(selectedExecution.startedAt).valueOf())
      : null;
  const pauseEnabled =
    selectedTask !== null &&
    ["queued", "running"].includes(selectedTask.status) &&
    selectedTask.pendingControl !== "pause";
  const resumeEnabled =
    selectedTask !== null && ["paused", "interrupted", "budget_wait"].includes(selectedTask.status);
  const stopEnabled =
    selectedTask !== null && !["completed", "stopping", "stopped"].includes(selectedTask.status);

  const handleResizeTaskList = useCallback(
    (_groupId: string, sizes: number[]) => {
      if (surfaceWidth <= 0) {
        return;
      }
      updateSurface({
        serverId,
        workspaceId,
        taskListWidth: clampBackgroundTasksListWidth(
          surfaceWidth * (sizes[0] ?? taskListResizeSizes[0] ?? 0),
          surfaceWidth,
        ),
      });
    },
    [serverId, surfaceWidth, taskListResizeSizes, updateSurface, workspaceId],
  );

  if (!client) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>Tasks unavailable</Text>
        <Text style={styles.emptyText}>Connect the Thoth host to inspect Workspace tasks.</Text>
      </View>
    );
  }

  return (
    <View
      style={[styles.root, useStackedLayout && styles.rootStacked]}
      onLayout={(event) => setSurfaceWidth(event.nativeEvent.layout.width)}
      testID="background-tasks-panel"
    >
      <View
        style={[
          styles.sidebar,
          useStackedLayout ? styles.sidebarStacked : { width: taskListWidth },
        ]}
        testID="background-task-list-pane"
      >
        <View style={styles.sidebarHeader}>
          <Text style={styles.sidebarTitle}>Tasks</Text>
          <Pressable
            accessibilityLabel="Refresh tasks"
            onPress={() => void refreshList()}
            style={styles.iconButton}
          >
            <RefreshCw size={15} />
          </Pressable>
        </View>
        {tasks.length === 0 ? (
          <View style={styles.emptyList}>
            <Text style={styles.emptyText}>No approved tasks yet.</Text>
          </View>
        ) : (
          <ScrollView style={styles.taskListScroll} contentContainerStyle={styles.taskList}>
            {tasks.map((task) => (
              <Pressable
                key={task.id}
                onPress={() => setSelectedTaskId(task.id)}
                style={[styles.taskRow, task.id === selectedTaskId && styles.taskRowSelected]}
                testID={`background-task-row-${task.id}`}
              >
                <Text style={styles.taskRowTitle}>{task.title}</Text>
                <Text style={styles.taskRowMeta}>
                  {task.mode === "loop" ? "Loop" : "Quick"} | {taskStatusLabel(task.status)}
                </Text>
                <Text style={styles.taskRowSummary} numberOfLines={2}>
                  {task.summary}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>

      {isWeb && !useStackedLayout ? (
        <ResizeHandle
          direction="horizontal"
          groupId={`background-task-list-${surfaceKey}`}
          index={0}
          sizes={taskListResizeSizes}
          onResizeSplit={handleResizeTaskList}
        />
      ) : null}

      <View style={[styles.detail, useStackedLayout && styles.detailStacked]}>
        {selectedTask ? (
          <ScrollView
            contentContainerStyle={styles.detailContent}
            testID="background-task-detail-scroll"
          >
            <View style={[styles.detailHeader, useNarrowDetailHeader && styles.detailHeaderNarrow]}>
              <View style={styles.detailTitleBlock}>
                <Text style={styles.detailTitle}>{selectedTask.title}</Text>
                <Text style={styles.detailStatus}>
                  {taskStatusLabel(selectedTask.status)} | revision {selectedTask.revision}
                </Text>
              </View>
              <View style={styles.headerActions}>
                <ActionButton
                  testID="background-task-resume"
                  label="Resume"
                  icon={
                    pendingAction === "resume" ? (
                      <ActivityIndicator size="small" />
                    ) : (
                      <Play size={14} />
                    )
                  }
                  disabled={pendingAction !== null || !resumeEnabled}
                  onPress={() => void handleTaskAction("resume")}
                />
                <ActionButton
                  testID="background-task-pause"
                  label={selectedTask.pendingControl === "pause" ? "Pausing" : "Pause"}
                  icon={
                    pendingAction === "pause" ? (
                      <ActivityIndicator size="small" />
                    ) : (
                      <Pause size={14} />
                    )
                  }
                  disabled={pendingAction !== null || !pauseEnabled}
                  onPress={() => void handleTaskAction("pause")}
                />
                <ActionButton
                  testID="background-task-stop"
                  label={selectedTask.status === "stopping" ? "Canceling" : "Stop"}
                  icon={
                    pendingAction === "stop" ? (
                      <ActivityIndicator size="small" />
                    ) : (
                      <Square size={14} />
                    )
                  }
                  disabled={pendingAction !== null || !stopEnabled}
                  onPress={() => void handleTaskAction("stop")}
                />
              </View>
            </View>

            <Text style={styles.detailSummary}>{selectedTask.summary}</Text>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            {approvalExecution && pendingApproval ? (
              <View style={styles.section} testID="background-execution-approval">
                <Text style={styles.sectionTitle}>{pendingApproval.title}</Text>
                {pendingApproval.description ? (
                  <Text style={styles.sectionBody}>{pendingApproval.description}</Text>
                ) : null}
                <Text style={styles.sectionMuted}>{timelineText(pendingApproval.displayed)}</Text>
                <Text style={styles.sectionMuted} testID="background-execution-approval-countdown">
                  {approvalCountdownLabel(pendingApproval.deadlineAt, now)}
                </Text>
                <View style={styles.headerActions}>
                  <ActionButton
                    testID="background-execution-approval-accept"
                    label={pendingApproval.kind === "implement" ? "Implement" : "Allow"}
                    icon={
                      pendingAction === "approval" ? (
                        <ActivityIndicator size="small" />
                      ) : (
                        <CheckCircle2 size={14} />
                      )
                    }
                    disabled={pendingAction !== null}
                    onPress={() =>
                      void handleExecutionApproval(
                        pendingApproval.kind === "implement" ? "implement" : "allow",
                      )
                    }
                  />
                  <ActionButton
                    testID="background-execution-approval-deny"
                    label="Deny"
                    icon={<XCircle size={14} />}
                    disabled={pendingAction !== null}
                    onPress={() => void handleExecutionApproval("deny")}
                  />
                </View>
              </View>
            ) : null}

            {selectedTask.pendingDecision ? (
              <View style={styles.section} testID="loop-user-decision-card">
                <Text style={styles.sectionTitle}>{selectedTask.pendingDecision.title}</Text>
                <Text style={styles.sectionBody}>{selectedTask.pendingDecision.question}</Text>
                <View style={styles.decisionOptions}>
                  {selectedTask.pendingDecision.options.map((option) => (
                    <Pressable
                      key={option.id}
                      testID={`loop-user-decision-option-${option.id}`}
                      disabled={pendingAction !== null}
                      onPress={() => setDecisionChoiceId(option.id)}
                      style={[
                        styles.decisionOption,
                        decisionChoiceId === option.id && styles.decisionOptionSelected,
                      ]}
                    >
                      <Text style={styles.decisionOptionLabel}>{option.label}</Text>
                      {option.description ? (
                        <Text style={styles.sectionMuted}>{option.description}</Text>
                      ) : null}
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  testID="loop-user-decision-note"
                  value={decisionNote}
                  onChangeText={setDecisionNote}
                  editable={pendingAction === null}
                  placeholder={selectedTask.pendingDecision.notePlaceholder ?? "Optional context"}
                  placeholderTextColor="#77808d"
                  multiline
                  style={styles.decisionNote}
                />
                <ActionButton
                  testID="loop-user-decision-submit"
                  label="Continue"
                  icon={
                    pendingAction === "decision" ? (
                      <ActivityIndicator size="small" />
                    ) : (
                      <Play size={14} />
                    )
                  }
                  disabled={pendingAction !== null || !decisionChoiceId}
                  onPress={() => void handleDecision()}
                />
              </View>
            ) : null}

            {selectedTask.status === "budget_wait" ? (
              <View style={styles.section} testID="loop-budget-wait">
                <Text style={styles.sectionTitle}>Review budget reached</Text>
                <Text style={styles.sectionBody}>
                  {selectedTask.budget.usedFailedReviews} of {selectedTask.budget.maxFailedReviews}{" "}
                  failed Reviews used.
                </Text>
                <View style={styles.headerActions}>
                  <ActionButton
                    testID="background-task-budget-continue"
                    label="Raise strength"
                    icon={
                      pendingAction === "raise_budget" ? (
                        <ActivityIndicator size="small" />
                      ) : (
                        <Play size={14} />
                      )
                    }
                    disabled={pendingAction !== null || selectedTask.budget.strength === "infinite"}
                    onPress={() => void handleTaskAction("raise_budget")}
                  />
                  <ActionButton
                    testID="background-task-review-only"
                    label="Review only"
                    icon={
                      pendingAction === "review_only" ? (
                        <ActivityIndicator size="small" />
                      ) : (
                        <CheckCircle2 size={14} />
                      )
                    }
                    disabled={pendingAction !== null}
                    onPress={() => void handleTaskAction("review_only")}
                  />
                </View>
              </View>
            ) : null}

            <View style={styles.metricsRow}>
              <Text style={styles.sectionMuted}>
                Review {selectedTask.budget.usedFailedReviews}/
                {selectedTask.budget.maxFailedReviews}
              </Text>
              <Text style={styles.sectionMuted}>
                Tokens {selectedTask.budget.tokenCount.toLocaleString()}
              </Text>
              <Text style={styles.sectionMuted}>
                Tools {selectedTask.budget.toolCallCount.toLocaleString()}
              </Text>
            </View>

            <View style={styles.goalRail}>
              {selectedTask.goals.map((goal) => (
                <Pressable
                  key={goal.id}
                  onPress={() => setSelectedGoalId(goal.id)}
                  style={[styles.goalRow, goal.id === selectedGoalId && styles.goalRowSelected]}
                  testID={`loop-goal-row-${goal.id}`}
                >
                  {goal.status === "passed" ? (
                    <ThemedCheckCircle size={16} uniProps={successColorMapping} />
                  ) : goal.status === "blocked" ? (
                    <ThemedXCircle size={16} uniProps={dangerColorMapping} />
                  ) : goal.id === selectedTask.currentGoalId && isExecutionBusy(busyExecution) ? (
                    <ActivityIndicator size="small" />
                  ) : (
                    <ThemedListTodo size={16} uniProps={mutedColorMapping} />
                  )}
                  <View style={styles.goalTextBlock}>
                    <Text style={styles.goalTitle}>
                      Goal {goal.order}: {goal.title}
                    </Text>
                    <Text style={styles.goalMeta}>
                      {goal.status} | revision {goal.revision}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>

            {selectedGoal ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Goal contract</Text>
                <Text style={styles.sectionBody}>{selectedGoal.goal}</Text>
                <Text style={styles.sectionMuted}>
                  Acceptance: {selectedGoal.acceptance.join("; ")}
                </Text>
              </View>
            ) : null}

            <View style={styles.phaseList}>
              {visibleExecutions.length === 0 ? (
                <Text style={styles.emptyText}>No execution attempt exists for this goal yet.</Text>
              ) : (
                visibleExecutions.map((execution) => {
                  const active = execution.id === selectedTask.currentExecutionId;
                  return (
                    <Pressable
                      key={execution.id}
                      onPress={() => setSelectedExecutionId(execution.id)}
                      style={[
                        styles.phaseRow,
                        execution.id === selectedExecutionId && styles.phaseRowSelected,
                      ]}
                      testID={`task-execution-${execution.id}`}
                    >
                      {active && isExecutionBusy(execution) ? (
                        <ActivityIndicator size="small" />
                      ) : (
                        <Clock3 size={15} />
                      )}
                      <View style={styles.goalTextBlock}>
                        <Text style={styles.phaseTitle}>
                          {execution.phase === "planexec"
                            ? "PlanExec"
                            : execution.phase === "review"
                              ? "Review"
                              : "Quick Exec"}
                        </Text>
                        <Text style={styles.phaseMeta}>
                          {executionStatusLabel(execution.status)} |{" "}
                          {formatTimestamp(execution.startedAt)}
                          {execution.id === selectedExecutionId && elapsed ? ` | ${elapsed}` : ""}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })
              )}
            </View>

            {selectedExecution ? (
              <View style={styles.section} testID="task-runtime-attachment">
                <Text style={styles.sectionTitle}>Runtime attachment</Text>
                {selectedExecution.attachment ? (
                  <Text style={styles.sectionMuted}>
                    {selectedExecution.attachment.bundleId} | {selectedExecution.attachment.status}{" "}
                    | {selectedExecution.attachment.bundleDigest}
                  </Text>
                ) : (
                  <Text style={styles.sectionMuted}>No RuntimeBundle receipt was recorded.</Text>
                )}
                {selectedExecution.summary ? (
                  <Text style={styles.sectionBody}>{selectedExecution.summary}</Text>
                ) : null}
                {selectedExecution.latestApproval?.resolution ? (
                  <Text style={styles.sectionMuted} testID="background-execution-approval-result">
                    Last approval: {selectedExecution.latestApproval.resolution.decision} by{" "}
                    {selectedExecution.latestApproval.resolution.actorId}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {selectedTask.latestReviewDirection ? (
              <View style={styles.section} testID="task-review-direction">
                <Text style={styles.sectionTitle}>Review direction</Text>
                <Text style={styles.sectionBody}>{selectedTask.latestReviewDirection}</Text>
              </View>
            ) : null}

            <View style={styles.timelineShell} testID="loop-phase-timeline">
              <Text style={styles.sectionTitle}>Execution timeline</Text>
              {nextBeforeSeq ? (
                <ActionButton
                  testID="loop-phase-timeline-load-earlier"
                  label={loadingEarlier ? "Loading earlier" : "Load earlier"}
                  icon={loadingEarlier ? <ActivityIndicator size="small" /> : <Clock3 size={14} />}
                  disabled={loadingEarlier}
                  onPress={() => void loadEarlier()}
                />
              ) : null}
              {timelineLoading ? (
                <View style={styles.emptyTimeline}>
                  <ActivityIndicator size="small" />
                  <Text style={styles.emptyText}>Loading durable timeline...</Text>
                </View>
              ) : timeline.length === 0 ? (
                <View style={styles.emptyTimeline}>
                  <Text style={styles.emptyText}>
                    No timeline entries are recorded for this execution.
                  </Text>
                </View>
              ) : (
                timeline.map((entry) => (
                  <View key={entry.seq} style={styles.timelineEntry}>
                    <Text style={styles.timelineMeta}>
                      #{entry.seq} | {formatTimestamp(entry.occurredAt)}
                    </Text>
                    <Text style={styles.timelineText}>{timelineText(entry.item)}</Text>
                  </View>
                ))
              )}
            </View>

            {decisions.length > 0 ? (
              <View style={styles.section} testID="task-human-decisions">
                <Text style={styles.sectionTitle}>Human decisions</Text>
                {decisions.map((decision) => (
                  <View key={decision.id} style={styles.decisionRecord}>
                    <Text style={styles.decisionOptionLabel}>{decision.kind}</Text>
                    <Text style={styles.sectionMuted}>
                      {formatTimestamp(decision.decidedAt)} | {decision.actorId}
                    </Text>
                    <Text style={styles.sectionBody}>{timelineText(decision.rawAnswer)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </ScrollView>
        ) : (
          <View style={styles.emptyState}>
            <ThemedListTodo size={20} uniProps={mutedColorMapping} />
            <Text style={styles.emptyTitle}>No task selected</Text>
            <Text style={styles.emptyText}>Approved Quick and Loop tasks appear here.</Text>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, flexDirection: "row", backgroundColor: theme.colors.surface0 },
  rootStacked: { flexDirection: "column" },
  sidebar: {
    flexShrink: 0,
    borderRightWidth: theme.borderWidth[1],
    borderRightColor: theme.colors.border,
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  sidebarStacked: { width: "100%", maxHeight: 280 },
  sidebarHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sidebarTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  iconButton: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  taskListScroll: { flexShrink: 1 },
  taskList: { gap: theme.spacing[2] },
  taskRow: {
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    padding: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
    gap: theme.spacing[1],
  },
  taskRowSelected: {
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface2,
  },
  taskRowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  taskRowMeta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  taskRowSummary: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  detail: { flex: 1, minWidth: 0, padding: theme.spacing[4] },
  detailStacked: { minHeight: 0 },
  detailContent: { gap: theme.spacing[4], paddingBottom: theme.spacing[8] },
  detailHeader: { flexDirection: "row", justifyContent: "space-between", gap: theme.spacing[3] },
  detailHeaderNarrow: { flexDirection: "column", alignItems: "stretch" },
  detailTitleBlock: { flex: 1, gap: theme.spacing[1] },
  detailTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
  },
  detailStatus: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  detailSummary: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  actionButton: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  actionButtonDisabled: { opacity: 0.45 },
  actionText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  section: {
    gap: theme.spacing[2],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing[3],
  },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  sectionBody: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, lineHeight: 20 },
  sectionMuted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 18,
  },
  metricsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[4],
    flexWrap: "wrap",
  },
  goalRail: { gap: theme.spacing[2] },
  goalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
  },
  goalRowSelected: { backgroundColor: theme.colors.surface2, borderRadius: theme.borderRadius.md },
  goalTextBlock: { flex: 1, minWidth: 0, gap: 2 },
  goalTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  goalMeta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  phaseList: { gap: theme.spacing[2] },
  phaseRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[2],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
  },
  phaseRowSelected: {
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface1,
  },
  phaseTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  phaseMeta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  timelineShell: {
    gap: theme.spacing[3],
    minHeight: 140,
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing[3],
  },
  timelineEntry: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  timelineMeta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  timelineText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, lineHeight: 20 },
  emptyTimeline: {
    minHeight: 100,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
  },
  decisionOptions: { gap: theme.spacing[2] },
  decisionOption: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[3],
    gap: theme.spacing[1],
  },
  decisionOptionSelected: {
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface2,
  },
  decisionOptionLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  decisionNote: {
    minHeight: 72,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[3],
    color: theme.colors.foreground,
    textAlignVertical: "top",
  },
  decisionRecord: { gap: theme.spacing[1], paddingVertical: theme.spacing[2] },
  emptyList: { paddingVertical: theme.spacing[4] },
  emptyState: {
    flex: 1,
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[6],
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  errorText: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
}));
