import {
  timelineId,
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
}

export function deriveStreamTurnTiming(params: {
  agentStatus: string;
  tail: TimelineRenderItem[];
  head: TimelineRenderItem[];
}): StreamTurnTiming {
  const byAssistantId = new Map<string, TurnTiming>();
  let currentUserAt: Date | null = null;
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

  const runningStartedAt =
    params.agentStatus === "running"
      ? (findLastUserMessageTimestamp(params.head) ?? currentUserAt)
      : null;
  if (params.agentStatus !== "running") {
    flushCompletedTurn();
  }

  return {
    byAssistantId,
    runningStartedAt,
  };
}

function findLastUserMessageTimestamp(items: TimelineRenderItem[]): Date | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item && timelineType(item) === "user_message") {
      return timelineTimestamp(item);
    }
  }
  return null;
}
