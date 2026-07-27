import {
  timelineId,
  isPendingTimelineItem,
  timelineTimestamp,
  timelineType,
  type TimelineRenderItem,
} from "@/agent-stream/timeline-view-registry";

export interface TurnTiming {
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
}

export interface StreamTurnTiming {
  byAssistantId: Map<string, TurnTiming>;
  runningStartedAt: Date | null;
  isActive: boolean;
}

export function deriveStreamTurnTiming(params: {
  agentStatus: string;
  tail: TimelineRenderItem[];
  head: TimelineRenderItem[];
}): StreamTurnTiming {
  const byAssistantId = new Map<string, TurnTiming>();
  let currentUserAt: Date | null = null;
  let currentAuthoritativeUserAt: Date | null = null;
  let currentUserIsPending = false;
  let currentLastItemAt: Date | null = null;
  let currentAssistantIds: string[] = [];

  const flushCompletedTurn = () => {
    if (!currentUserAt || !currentLastItemAt || currentAssistantIds.length === 0) {
      return;
    }
    const timing: TurnTiming = {
      startedAt: currentUserAt,
      completedAt: currentLastItemAt,
      durationMs: Math.max(0, currentLastItemAt.getTime() - currentUserAt.getTime()),
    };
    for (const id of currentAssistantIds) {
      byAssistantId.set(id, timing);
    }
  };

  const visitItem = (item: TimelineRenderItem) => {
    if (timelineType(item) === "user_message") {
      flushCompletedTurn();
      currentUserAt = timelineTimestamp(item);
      currentAuthoritativeUserAt = isPendingTimelineItem(item) ? null : currentUserAt;
      currentUserIsPending = isPendingTimelineItem(item);
      currentLastItemAt = null;
      currentAssistantIds = [];
      return;
    }
    if (!currentUserAt) {
      return;
    }
    currentLastItemAt = timelineTimestamp(item);
    if (timelineType(item) === "assistant_message") {
      currentAssistantIds.push(timelineId(item));
    }
  };

  for (const item of params.tail) {
    visitItem(item);
  }
  for (const item of params.head) {
    visitItem(item);
  }

  const isRunning = params.agentStatus === "running";
  const runningStartedAt = isRunning ? currentAuthoritativeUserAt : null;
  if (params.agentStatus !== "running") {
    flushCompletedTurn();
  }

  return {
    byAssistantId,
    runningStartedAt,
    isActive: isRunning || currentUserIsPending,
  };
}
