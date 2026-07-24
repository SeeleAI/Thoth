import type {
  AgentProvider,
  AgentTimelineEntry,
  ToolCallDetail,
} from "@thoth/protocol/agent-types";
import type { AgentAttachment } from "@thoth/protocol/messages";
import type { TaskProjection } from "@thoth/protocol/task-authority";
import type {
  ThothApprovalGoalCardModel,
  ThothClarifyCardModel,
  ThothTaskCardModel,
} from "@thoth/protocol/thoth/rpc-schemas";
import type { AttachmentMetadata } from "@/attachments/types";

interface TimelineViewModelBase {
  id: string;
  timestamp: Date;
}

export type UserMessageImageAttachment = AttachmentMetadata;

export interface UserMessageViewModel extends TimelineViewModelBase {
  kind: "user_message";
  text: string;
  optimistic?: true;
  images?: UserMessageImageAttachment[];
  attachments?: AgentAttachment[];
}

export interface AssistantMessageViewModel extends TimelineViewModelBase {
  kind: "assistant_message";
  messageId?: string;
  text: string;
  blockGroupId?: string;
  blockIndex?: number;
}

export interface ReasoningViewModel extends TimelineViewModelBase {
  kind: "thought";
  text: string;
  status: "loading" | "ready";
}

export interface ToolCallViewModel extends TimelineViewModelBase {
  kind: "tool_call";
  payload:
    | {
        source: "agent";
        data: {
          provider: AgentProvider;
          callId: string;
          name: string;
          status: "running" | "completed" | "failed" | "canceled";
          error: unknown;
          detail: ToolCallDetail;
          metadata?: Record<string, unknown>;
        };
      }
    | {
        source: "orchestrator";
        data: {
          toolCallId: string;
          toolName: string;
          arguments: unknown;
          result?: unknown;
          error?: unknown;
          status: "executing" | "completed" | "failed";
        };
      };
}

export interface ClarifyCardViewModel extends TimelineViewModelBase {
  kind: "clarify_card";
  card: ThothClarifyCardModel;
}

export interface TaskCardViewModel extends TimelineViewModelBase {
  kind: "task_card";
  card: ThothTaskCardModel;
}

export interface GoalCardViewModel extends TimelineViewModelBase {
  kind: "goal_card";
  card: ThothApprovalGoalCardModel;
}

export interface RegisteredTaskViewModel extends TimelineViewModelBase {
  kind: "registered_task";
  task: TaskProjection;
}

export interface ActivityLogViewModel extends TimelineViewModelBase {
  kind: "activity_log";
  activityType: "system" | "info" | "success" | "error";
  message: string;
  metadata?: Record<string, unknown>;
}

export interface TodoEntry {
  text: string;
  completed: boolean;
}

export interface TodoListViewModel extends TimelineViewModelBase {
  kind: "todo_list";
  provider: AgentProvider;
  items: TodoEntry[];
}

export interface CompactionViewModel extends TimelineViewModelBase {
  kind: "compaction";
  status: "loading" | "completed";
  trigger?: "auto" | "manual";
  preTokens?: number;
}

export type TimelineViewModel =
  | UserMessageViewModel
  | AssistantMessageViewModel
  | ReasoningViewModel
  | ToolCallViewModel
  | ClarifyCardViewModel
  | TaskCardViewModel
  | GoalCardViewModel
  | RegisteredTaskViewModel
  | ActivityLogViewModel
  | TodoListViewModel
  | CompactionViewModel;

export function hasPendingAuthorityDecisionViewModel(items: readonly TimelineViewModel[]): boolean {
  return items.some((item) => {
    if (
      (item.kind === "clarify_card" || item.kind === "task_card" || item.kind === "goal_card") &&
      item.card.submitted === false
    ) {
      return true;
    }
    if (item.kind !== "tool_call") return false;
    if (item.payload.source !== "agent") return false;
    const { data } = item.payload;
    return (
      data.status === "running" &&
      data.metadata?.thothAuthorityDecision === true &&
      data.metadata?.pendingAuthorityDecision !== false
    );
  });
}

export interface TimelineViewContext {
  finalEntryIsLiveReasoning: boolean;
}

type ViewFactory<TType extends AgentTimelineEntry["item"]["type"]> = (
  entry: AgentTimelineEntry & { item: Extract<AgentTimelineEntry["item"], { type: TType }> },
  context: TimelineViewContext,
) => TimelineViewModel;

type TimelineViewRegistry = {
  [Type in AgentTimelineEntry["item"]["type"]]: ViewFactory<Type>;
};

export const timelineViewRegistry = {
  user_message: (entry) => ({
    kind: "user_message",
    id: entry.item.messageId ?? timelineKey(entry),
    text: entry.item.text,
    timestamp: new Date(entry.timestamp),
  }),
  assistant_message: (entry) => ({
    kind: "assistant_message",
    id: entry.item.messageId ?? timelineKey(entry),
    messageId: entry.item.messageId,
    text: entry.item.text,
    timestamp: new Date(entry.timestamp),
  }),
  reasoning: (entry, context) => ({
    kind: "thought",
    id: timelineKey(entry),
    text: entry.item.text,
    timestamp: new Date(entry.timestamp),
    status: context.finalEntryIsLiveReasoning ? "loading" : "ready",
  }),
  clarify_card: (entry) => ({
    kind: "clarify_card",
    id: timelineKey(entry),
    timestamp: new Date(entry.timestamp),
    card: entry.item.card,
  }),
  task_card: (entry) => ({
    kind: "task_card",
    id: timelineKey(entry),
    timestamp: new Date(entry.timestamp),
    card: entry.item.card,
  }),
  goal_card: (entry) => ({
    kind: "goal_card",
    id: timelineKey(entry),
    timestamp: new Date(entry.timestamp),
    card: entry.item.card,
  }),
  registered_task: (entry) => ({
    kind: "registered_task",
    id: timelineKey(entry),
    timestamp: new Date(entry.timestamp),
    task: entry.item.task,
  }),
  tool_call: (entry) => ({
    kind: "tool_call",
    id: entry.item.callId || timelineKey(entry),
    timestamp: new Date(entry.timestamp),
    payload: {
      source: "agent",
      data: {
        provider: entry.provider,
        callId: entry.item.callId,
        name: entry.item.name,
        status: entry.item.status,
        error: entry.item.error,
        detail: entry.item.detail,
        metadata: entry.item.metadata,
      },
    },
  }),
  todo: (entry) => ({
    kind: "todo_list",
    id: timelineKey(entry),
    timestamp: new Date(entry.timestamp),
    provider: entry.provider,
    items: entry.item.items,
  }),
  error: (entry) => ({
    kind: "activity_log",
    id: timelineKey(entry),
    timestamp: new Date(entry.timestamp),
    activityType: "error",
    message: entry.item.message,
  }),
  compaction: (entry) => ({
    kind: "compaction",
    id: timelineKey(entry),
    timestamp: new Date(entry.timestamp),
    status: entry.item.status,
    trigger: entry.item.trigger,
    preTokens: entry.item.preTokens,
  }),
} satisfies TimelineViewRegistry;

export function createTimelineViewModels(
  entries: readonly AgentTimelineEntry[],
  input: { agentIsRunning: boolean },
): TimelineViewModel[] {
  return entries.map((entry, index) => {
    const factory = timelineViewRegistry[entry.item.type] as ViewFactory<
      AgentTimelineEntry["item"]["type"]
    >;
    return factory(entry, {
      finalEntryIsLiveReasoning:
        input.agentIsRunning && index === entries.length - 1 && entry.item.type === "reasoning",
    });
  });
}

function timelineKey(entry: AgentTimelineEntry): string {
  return `${entry.seqStart}:${entry.seqEnd}`;
}
