import { useCallback, useEffect, useMemo, useState } from "react";
import { router } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { CalendarClock, Pause, Play, Plus, RefreshCw, Save, Trash2 } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { AgentProviderSchema } from "@thoth/protocol/provider-manifest";
import type {
  ScheduleCadence,
  ScheduleRun,
  ScheduleSummary,
  StoredSchedule,
} from "@thoth/protocol/schedule/types";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import {
  buildBackgroundTasksSurfaceKey,
  useBackgroundTasksSurfaceStore,
} from "@/stores/background-tasks-surface-store";
import { buildHostWorkspaceTasksRoute } from "@/utils/host-routes";

interface AgentChoice {
  id: string;
  title: string;
}

interface ScheduleEditorState {
  name: string;
  prompt: string;
  cadenceType: "every" | "cron";
  everyMinutes: string;
  cronExpression: string;
  timezone: string;
  targetType: "new-agent" | "agent";
  agentId: string;
  provider: string;
  model: string;
  modeId: string;
  isolation: "same-workspace" | "worktree";
  maxRuns: string;
  expiresAt: string;
  runOnCreate: boolean;
}

const EMPTY_EDITOR: ScheduleEditorState = {
  name: "",
  prompt: "",
  cadenceType: "every",
  everyMinutes: "60",
  cronExpression: "0 9 * * *",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  targetType: "new-agent",
  agentId: "",
  provider: "codex",
  model: "",
  modeId: "",
  isolation: "same-workspace",
  maxRuns: "",
  expiresAt: "",
  runOnCreate: true,
};

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function formatCadence(cadence: ScheduleCadence): string {
  if (cadence.type === "every") {
    const minutes = cadence.everyMs / 60_000;
    return minutes >= 60 && minutes % 60 === 0
      ? `Every ${minutes / 60} hour${minutes === 60 ? "" : "s"}`
      : `Every ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${cadence.expression}${cadence.timezone ? ` (${cadence.timezone})` : " (UTC)"}`;
}

function scheduleToEditor(schedule: StoredSchedule): ScheduleEditorState {
  const target = schedule.target;
  return {
    name: schedule.name ?? "",
    prompt: schedule.prompt,
    cadenceType: schedule.cadence.type,
    everyMinutes:
      schedule.cadence.type === "every" ? String(schedule.cadence.everyMs / 60_000) : "60",
    cronExpression: schedule.cadence.type === "cron" ? schedule.cadence.expression : "0 9 * * *",
    timezone:
      schedule.cadence.type === "cron"
        ? (schedule.cadence.timezone ?? "UTC")
        : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    targetType: target.type,
    agentId: target.type === "agent" ? target.agentId : "",
    provider: target.type === "new-agent" ? target.config.provider : "codex",
    model: target.type === "new-agent" ? (target.config.model ?? "") : "",
    modeId: target.type === "new-agent" ? (target.config.modeId ?? "") : "",
    isolation:
      target.type === "new-agent"
        ? (target.config.isolation ?? "same-workspace")
        : "same-workspace",
    maxRuns: schedule.maxRuns == null ? "" : String(schedule.maxRuns),
    expiresAt: schedule.expiresAt ?? "",
    runOnCreate: false,
  };
}

function parsePositiveInteger(value: string, label: string): number | undefined {
  const normalized = value.trim();
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function editorCadence(editor: ScheduleEditorState): ScheduleCadence {
  if (editor.cadenceType === "every") {
    const minutes = Number(editor.everyMinutes.trim());
    if (!Number.isFinite(minutes) || minutes <= 0) {
      throw new Error("Interval must be a positive number of minutes");
    }
    return { type: "every", everyMs: Math.round(minutes * 60_000) };
  }
  const expression = editor.cronExpression.trim();
  if (!expression) throw new Error("Cron expression is required");
  const timezone = editor.timezone.trim();
  return { type: "cron", expression, ...(timezone ? { timezone } : {}) };
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  testID?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#7b7b82"
        multiline={multiline}
        style={[styles.input, multiline && styles.inputMultiline]}
      />
    </View>
  );
}

function Choice({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.choice, selected && styles.choiceSelected]}
    >
      <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function Action({
  label,
  onPress,
  disabled,
  destructive,
  testID,
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
  testID?: string;
  icon?: React.ReactNode;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.action,
        destructive && styles.actionDestructive,
        disabled && styles.actionDisabled,
      ]}
    >
      {icon}
      <Text style={[styles.actionText, destructive && styles.actionTextDestructive]}>{label}</Text>
    </Pressable>
  );
}

export function SchedulesPanel({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}) {
  const client = useHostRuntimeClient(serverId);
  const compact = useIsCompactFormFactor();
  const surfaceKey = buildBackgroundTasksSurfaceKey({ serverId, workspaceId });
  const persistedSurface = useBackgroundTasksSurfaceStore(
    (state) => state.byWorkspaceKey[surfaceKey],
  );
  const updateSurface = useBackgroundTasksSurfaceStore((state) => state.updateSurface);
  const [schedules, setSchedules] = useState<ScheduleSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => persistedSurface?.selectedScheduleId ?? null,
  );
  const [selected, setSelected] = useState<StoredSchedule | null>(null);
  const [agentChoices, setAgentChoices] = useState<AgentChoice[]>([]);
  const [editor, setEditor] = useState<ScheduleEditorState>(EMPTY_EDITOR);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patchEditor = useCallback(
    (patch: Partial<ScheduleEditorState>) => setEditor((current) => ({ ...current, ...patch })),
    [],
  );

  const refresh = useCallback(async () => {
    if (!client) return;
    const [scheduleResponse, agentResponse] = await Promise.all([
      client.scheduleList({ workspaceId }),
      client.fetchAgents({ scope: "active", page: { limit: 200 } }),
    ]);
    if (scheduleResponse.error) {
      setError(scheduleResponse.error);
    } else {
      setSchedules(scheduleResponse.schedules);
      setSelectedId((current) => {
        if (current && scheduleResponse.schedules.some((item) => item.id === current)) {
          return current;
        }
        return scheduleResponse.schedules[0]?.id ?? null;
      });
    }
    setAgentChoices(
      agentResponse.entries
        .map((entry) => entry.agent)
        .filter((agent) => agent.workspaceId === workspaceId && !agent.archivedAt)
        .map((agent) => ({ id: agent.id, title: agent.title || agent.id })),
    );
  }, [client, workspaceId]);

  const refreshSelected = useCallback(
    async (scheduleId: string) => {
      if (!client) return;
      const response = await client.scheduleInspect({ workspaceId, id: scheduleId });
      if (response.error || !response.schedule) {
        setError(response.error ?? `Schedule ${scheduleId} was not found`);
        setSelected(null);
        return;
      }
      setError(null);
      setSelected(response.schedule);
    },
    [client, workspaceId],
  );

  useEffect(() => {
    void refresh().catch((nextError) =>
      setError(nextError instanceof Error ? nextError.message : String(nextError)),
    );
  }, [refresh]);

  useEffect(() => {
    updateSurface({ serverId, workspaceId, selectedScheduleId: selectedId });
    if (!selectedId || creating) {
      setSelected(null);
      return;
    }
    void refreshSelected(selectedId).catch((nextError) =>
      setError(nextError instanceof Error ? nextError.message : String(nextError)),
    );
  }, [creating, refreshSelected, selectedId, serverId, updateSurface, workspaceId]);

  useEffect(() => setDeleteArmed(false), [selectedId]);

  const selectedSummary = useMemo(
    () => schedules.find((schedule) => schedule.id === selectedId) ?? null,
    [schedules, selectedId],
  );

  const beginCreate = () => {
    setCreating(true);
    setEditing(true);
    setSelectedId(null);
    setSelected(null);
    setEditor({ ...EMPTY_EDITOR });
    setError(null);
  };

  const beginEdit = () => {
    if (!selected) return;
    setEditor(scheduleToEditor(selected));
    setCreating(false);
    setEditing(true);
    setError(null);
  };

  const cancelEdit = () => {
    setEditing(false);
    if (creating) {
      setCreating(false);
      setSelectedId(schedules[0]?.id ?? null);
    }
  };

  const createSchedule = useCallback(async () => {
    if (!client) return;
    setBusy("create");
    try {
      const prompt = editor.prompt.trim();
      if (!prompt) throw new Error("Prompt is required");
      const cadence = editorCadence(editor);
      const maxRuns = parsePositiveInteger(editor.maxRuns, "Max runs");
      const expiresAt = editor.expiresAt.trim();
      if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
        throw new Error("Expiration must be an ISO date/time");
      }
      const target =
        editor.targetType === "agent"
          ? (() => {
              const agentId = editor.agentId.trim();
              if (!agentId) throw new Error("Select an existing Agent");
              return { type: "agent" as const, agentId };
            })()
          : (() => {
              const provider = AgentProviderSchema.parse(editor.provider.trim());
              const model = editor.model.trim();
              const modeId = editor.modeId.trim();
              return {
                type: "new-agent" as const,
                config: {
                  provider,
                  isolation: editor.isolation,
                  ...(model ? { model } : {}),
                  ...(modeId ? { modeId } : {}),
                },
              };
            })();
      const response = await client.scheduleCreate({
        workspaceId,
        prompt,
        name: editor.name.trim() || null,
        cadence,
        target,
        ...(maxRuns ? { maxRuns } : {}),
        ...(expiresAt ? { expiresAt } : {}),
        runOnCreate: editor.runOnCreate,
      });
      if (response.error || !response.schedule) {
        throw new Error(response.error ?? "Schedule was not created");
      }
      setCreating(false);
      setEditing(false);
      setSelectedId(response.schedule.id);
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(null);
    }
  }, [client, editor, refresh, workspaceId]);

  const updateSchedule = useCallback(async () => {
    if (!client || !selected) return;
    setBusy("update");
    try {
      const prompt = editor.prompt.trim();
      if (!prompt) throw new Error("Prompt is required");
      const maxRuns = editor.maxRuns.trim()
        ? parsePositiveInteger(editor.maxRuns, "Max runs")
        : null;
      const expiresAt = editor.expiresAt.trim();
      if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
        throw new Error("Expiration must be an ISO date/time");
      }
      const newAgentConfig =
        selected.target.type === "new-agent"
          ? {
              provider: AgentProviderSchema.parse(editor.provider.trim()),
              model: editor.model.trim() || null,
              modeId: editor.modeId.trim() || null,
              isolation: editor.isolation,
            }
          : undefined;
      const response = await client.scheduleUpdate({
        workspaceId,
        id: selected.id,
        name: editor.name.trim() || null,
        prompt,
        cadence: editorCadence(editor),
        ...(newAgentConfig ? { newAgentConfig } : {}),
        maxRuns,
        expiresAt: expiresAt || null,
      });
      if (response.error || !response.schedule) {
        throw new Error(response.error ?? "Schedule was not updated");
      }
      setEditing(false);
      await refresh();
      await refreshSelected(selected.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(null);
    }
  }, [client, editor, refresh, refreshSelected, selected, workspaceId]);

  const runAction = useCallback(
    async (action: "pause" | "resume" | "run" | "delete") => {
      if (!client || !selected) return;
      setBusy(action);
      try {
        const response =
          action === "pause"
            ? await client.schedulePause({ workspaceId, id: selected.id })
            : action === "resume"
              ? await client.scheduleResume({ workspaceId, id: selected.id })
              : action === "run"
                ? await client.scheduleRunOnce({ workspaceId, id: selected.id })
                : await client.scheduleDelete({ workspaceId, id: selected.id });
        if (response.error) throw new Error(response.error);
        if (action === "delete") {
          setSelectedId(null);
          setSelected(null);
          setDeleteArmed(false);
        }
        await refresh();
        if (action !== "delete") await refreshSelected(selected.id);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      } finally {
        setBusy(null);
      }
    },
    [client, refresh, refreshSelected, selected, workspaceId],
  );

  const openRunTask = useCallback(
    (run: ScheduleRun) => {
      if (!run.taskId || !run.workspaceId) {
        setError("The execution Workspace is unavailable for this legacy Schedule run");
        return;
      }
      updateSurface({
        serverId,
        workspaceId: run.workspaceId,
        open: true,
        activeTab: "tasks",
        selectedTaskId: run.taskId,
        selectedExecutionId: run.executionId,
        selectedGoalId: null,
      });
      router.push(buildHostWorkspaceTasksRoute(serverId, run.workspaceId));
    },
    [serverId, updateSurface],
  );

  if (!client) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Schedules unavailable</Text>
        <Text style={styles.muted}>Connect the Thoth host to manage Workspace schedules.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, compact && styles.rootCompact]} testID="schedules-panel">
      <View style={[styles.listPane, compact && styles.listPaneCompact]}>
        <View style={styles.listHeader}>
          <View style={styles.headingRow}>
            <CalendarClock size={17} />
            <Text style={styles.heading}>Schedules</Text>
          </View>
          <View style={styles.row}>
            <Pressable accessibilityLabel="Refresh schedules" onPress={() => void refresh()}>
              <RefreshCw size={16} />
            </Pressable>
            <Pressable
              testID="schedule-create-open"
              accessibilityLabel="New schedule"
              onPress={beginCreate}
            >
              <Plus size={18} />
            </Pressable>
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.scheduleList}>
          {schedules.length === 0 ? (
            <Text style={styles.muted}>No schedules in this Workspace.</Text>
          ) : (
            schedules.map((schedule) => (
              <Pressable
                key={schedule.id}
                testID={`schedule-row-${schedule.id}`}
                onPress={() => {
                  setCreating(false);
                  setEditing(false);
                  setSelectedId(schedule.id);
                }}
                style={[
                  styles.scheduleRow,
                  selectedId === schedule.id && styles.scheduleRowSelected,
                ]}
              >
                <Text style={styles.scheduleTitle}>{schedule.name || schedule.id}</Text>
                <Text style={styles.muted}>{formatCadence(schedule.cadence)}</Text>
                <Text style={styles.muted}>
                  {schedule.status} · next {formatTimestamp(schedule.nextRunAt)}
                </Text>
              </Pressable>
            ))
          )}
        </ScrollView>
      </View>

      <ScrollView style={styles.detailPane} contentContainerStyle={styles.detailContent}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {editing ? (
          <View
            style={styles.editor}
            testID={creating ? "schedule-create-form" : "schedule-edit-form"}
          >
            <Text style={styles.detailTitle}>{creating ? "New Schedule" : "Edit Schedule"}</Text>
            <Field
              testID="schedule-name"
              label="Name"
              value={editor.name}
              onChangeText={(name) => patchEditor({ name })}
            />
            <Field
              testID="schedule-prompt"
              label="Prompt"
              value={editor.prompt}
              onChangeText={(prompt) => patchEditor({ prompt })}
              multiline
            />
            <Text style={styles.fieldLabel}>Cadence</Text>
            <View style={styles.rowWrap}>
              <Choice
                testID="schedule-cadence-every"
                label="Every"
                selected={editor.cadenceType === "every"}
                onPress={() => patchEditor({ cadenceType: "every" })}
              />
              <Choice
                testID="schedule-cadence-cron"
                label="Cron"
                selected={editor.cadenceType === "cron"}
                onPress={() => patchEditor({ cadenceType: "cron" })}
              />
            </View>
            {editor.cadenceType === "every" ? (
              <Field
                testID="schedule-every-minutes"
                label="Interval (minutes)"
                value={editor.everyMinutes}
                onChangeText={(everyMinutes) => patchEditor({ everyMinutes })}
              />
            ) : (
              <>
                <Field
                  testID="schedule-cron"
                  label="Cron expression"
                  value={editor.cronExpression}
                  onChangeText={(cronExpression) => patchEditor({ cronExpression })}
                />
                <Field
                  testID="schedule-timezone"
                  label="Time zone"
                  value={editor.timezone}
                  onChangeText={(timezone) => patchEditor({ timezone })}
                  placeholder="UTC or America/New_York"
                />
              </>
            )}

            {creating ? (
              <>
                <Text style={styles.fieldLabel}>Target</Text>
                <View style={styles.rowWrap}>
                  <Choice
                    testID="schedule-target-new-agent"
                    label="New Agent"
                    selected={editor.targetType === "new-agent"}
                    onPress={() => patchEditor({ targetType: "new-agent" })}
                  />
                  <Choice
                    testID="schedule-target-existing-agent"
                    label="Existing Agent"
                    selected={editor.targetType === "agent"}
                    onPress={() => patchEditor({ targetType: "agent" })}
                  />
                </View>
              </>
            ) : null}

            {editor.targetType === "agent" ? (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Existing Agent</Text>
                {agentChoices.length === 0 ? (
                  <Text style={styles.muted}>No active Agent in this Workspace.</Text>
                ) : (
                  <View style={styles.rowWrap}>
                    {agentChoices.map((agent) => (
                      <Choice
                        key={agent.id}
                        testID={`schedule-agent-${agent.id}`}
                        label={agent.title}
                        selected={editor.agentId === agent.id}
                        onPress={() => patchEditor({ agentId: agent.id })}
                      />
                    ))}
                  </View>
                )}
              </View>
            ) : (
              <>
                <Field
                  testID="schedule-provider"
                  label="Provider"
                  value={editor.provider}
                  onChangeText={(provider) => patchEditor({ provider })}
                />
                <Field
                  testID="schedule-model"
                  label="Model (optional)"
                  value={editor.model}
                  onChangeText={(model) => patchEditor({ model })}
                />
                <Field
                  testID="schedule-mode"
                  label="Mode (optional)"
                  value={editor.modeId}
                  onChangeText={(modeId) => patchEditor({ modeId })}
                />
                <Text style={styles.fieldLabel}>Isolation</Text>
                <View style={styles.rowWrap}>
                  <Choice
                    testID="schedule-isolation-same-workspace"
                    label="Same Workspace"
                    selected={editor.isolation === "same-workspace"}
                    onPress={() => patchEditor({ isolation: "same-workspace" })}
                  />
                  <Choice
                    testID="schedule-isolation-worktree"
                    label="Worktree Workspace"
                    selected={editor.isolation === "worktree"}
                    onPress={() => patchEditor({ isolation: "worktree" })}
                  />
                </View>
              </>
            )}

            <Field
              testID="schedule-max-runs"
              label="Max runs (optional)"
              value={editor.maxRuns}
              onChangeText={(maxRuns) => patchEditor({ maxRuns })}
            />
            <Field
              testID="schedule-expires-at"
              label="Expires at (ISO, optional)"
              value={editor.expiresAt}
              onChangeText={(expiresAt) => patchEditor({ expiresAt })}
            />
            {creating ? (
              <View style={styles.switchRow}>
                <View>
                  <Text style={styles.fieldLabel}>Run after creation</Text>
                  <Text style={styles.muted}>Create a real Task and Execution immediately.</Text>
                </View>
                <Switch
                  testID="schedule-run-on-create"
                  value={editor.runOnCreate}
                  onValueChange={(runOnCreate) => patchEditor({ runOnCreate })}
                />
              </View>
            ) : null}
            <View style={styles.rowWrap}>
              <Action
                testID={creating ? "schedule-create-submit" : "schedule-edit-submit"}
                label={creating ? "Create" : "Save"}
                disabled={busy !== null}
                onPress={() => void (creating ? createSchedule() : updateSchedule())}
                icon={busy ? <ActivityIndicator size="small" /> : <Save size={14} />}
              />
              <Action label="Cancel" disabled={busy !== null} onPress={cancelEdit} />
            </View>
          </View>
        ) : selected ? (
          <View testID="schedule-detail">
            <View style={styles.detailHeader}>
              <View>
                <Text style={styles.detailTitle}>{selected.name || selected.id}</Text>
                <Text style={styles.muted}>{selected.status}</Text>
              </View>
              <Action
                testID="schedule-edit-open"
                label="Edit"
                disabled={busy !== null}
                onPress={beginEdit}
              />
            </View>
            <Text style={styles.prompt}>{selected.prompt}</Text>
            <View style={styles.metadata}>
              <Text style={styles.metaText}>Cadence: {formatCadence(selected.cadence)}</Text>
              <Text style={styles.metaText}>Next run: {formatTimestamp(selected.nextRunAt)}</Text>
              <Text style={styles.metaText}>Last run: {formatTimestamp(selected.lastRunAt)}</Text>
              <Text style={styles.metaText}>Expires: {formatTimestamp(selected.expiresAt)}</Text>
              <Text style={styles.metaText}>Max runs: {selected.maxRuns ?? "unlimited"}</Text>
              <Text style={styles.metaText}>
                Target:{" "}
                {selected.target.type === "agent"
                  ? selected.target.agentId
                  : selected.target.config.provider}
              </Text>
              {selected.target.type === "new-agent" ? (
                <Text style={styles.metaText}>
                  Isolation: {selected.target.config.isolation ?? "same-workspace"}
                </Text>
              ) : null}
            </View>
            <View style={styles.rowWrap}>
              {selected.status === "paused" ? (
                <Action
                  testID="schedule-resume"
                  label="Resume"
                  disabled={busy !== null}
                  onPress={() => void runAction("resume")}
                  icon={<Play size={14} />}
                />
              ) : (
                <Action
                  testID="schedule-pause"
                  label="Pause"
                  disabled={busy !== null || selected.status !== "active"}
                  onPress={() => void runAction("pause")}
                  icon={<Pause size={14} />}
                />
              )}
              <Action
                testID="schedule-run-now"
                label="Run now"
                disabled={busy !== null}
                onPress={() => void runAction("run")}
                icon={<Play size={14} />}
              />
              <Action
                testID="schedule-delete"
                label={deleteArmed ? "Confirm delete" : "Delete"}
                disabled={busy !== null}
                destructive
                onPress={() => {
                  if (!deleteArmed) {
                    setDeleteArmed(true);
                    return;
                  }
                  void runAction("delete");
                }}
                icon={<Trash2 size={14} />}
              />
            </View>

            <Text style={styles.sectionTitle}>Run history</Text>
            {selected.runs.length === 0 ? (
              <Text style={styles.muted}>This Schedule has not run yet.</Text>
            ) : (
              selected.runs
                .toSorted((left, right) => right.startedAt.localeCompare(left.startedAt))
                .map((run) => (
                  <View key={run.id} style={styles.runRow} testID={`schedule-run-${run.id}`}>
                    <View style={styles.runHeader}>
                      <Text style={styles.runTitle}>{run.status}</Text>
                      <Text style={styles.muted}>{formatTimestamp(run.startedAt)}</Text>
                    </View>
                    {run.output ? <Text style={styles.runOutput}>{run.output}</Text> : null}
                    {run.error ? <Text style={styles.error}>{run.error}</Text> : null}
                    <Text style={styles.muted}>
                      Task {run.taskId ?? "unavailable"} · Execution{" "}
                      {run.executionId ?? "unavailable"}
                    </Text>
                    <Action
                      testID={`schedule-open-task-${run.id}`}
                      label={
                        run.workspaceId && run.taskId ? "Open Task" : "Legacy Task unavailable"
                      }
                      disabled={!run.workspaceId || !run.taskId}
                      onPress={() => openRunTask(run)}
                    />
                  </View>
                ))
            )}
          </View>
        ) : selectedSummary ? (
          <ActivityIndicator size="small" />
        ) : (
          <View style={styles.empty}>
            <CalendarClock size={28} />
            <Text style={styles.emptyTitle}>Create a Schedule</Text>
            <Text style={styles.muted}>
              Every trigger creates a real Task and ExecutionAttempt under Workspace authority.
            </Text>
            <Action label="New Schedule" onPress={beginCreate} icon={<Plus size={14} />} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, minHeight: 0, flexDirection: "row", backgroundColor: theme.colors.surface0 },
  rootCompact: { flexDirection: "column" },
  listPane: {
    width: 310,
    minHeight: 0,
    borderRightWidth: theme.borderWidth[1],
    borderRightColor: theme.colors.border,
  },
  listPaneCompact: {
    width: "100%",
    maxHeight: 250,
    borderRightWidth: 0,
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  listHeader: {
    minHeight: 48,
    paddingHorizontal: theme.spacing[3],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  headingRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  heading: { color: theme.colors.foreground, fontWeight: theme.fontWeight.semibold },
  scheduleList: { padding: theme.spacing[2], gap: theme.spacing[1] },
  scheduleRow: { padding: theme.spacing[3], borderRadius: theme.borderRadius.md, gap: 3 },
  scheduleRowSelected: { backgroundColor: theme.colors.surface2 },
  scheduleTitle: { color: theme.colors.foreground, fontWeight: theme.fontWeight.medium },
  detailPane: { flex: 1, minWidth: 0 },
  detailContent: { padding: theme.spacing[4], gap: theme.spacing[3] },
  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  detailTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.semibold,
  },
  prompt: { color: theme.colors.foreground, fontSize: theme.fontSize.base, lineHeight: 22 },
  metadata: {
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    gap: 5,
  },
  metaText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  field: { gap: theme.spacing[1] },
  fieldLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  input: {
    minHeight: 40,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface1,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  inputMultiline: { minHeight: 112, textAlignVertical: "top" },
  editor: { gap: theme.spacing[3] },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[3] },
  rowWrap: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: theme.spacing[2] },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  choice: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  choiceSelected: {
    backgroundColor: theme.colors.surface3,
    borderColor: theme.colors.accentBright,
  },
  choiceText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  choiceTextSelected: { color: theme.colors.foreground },
  action: {
    minHeight: 34,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
  },
  actionDestructive: { borderColor: theme.colors.destructive },
  actionDisabled: { opacity: 0.45 },
  actionText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  actionTextDestructive: { color: theme.colors.destructive },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    marginTop: theme.spacing[3],
  },
  runRow: {
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    gap: theme.spacing[2],
  },
  runHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  runTitle: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
    textTransform: "capitalize",
  },
  runOutput: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  empty: {
    flex: 1,
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[4],
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
  },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
}));
