import type { DaemonClient } from "@thoth/client/internal/daemon-client";
import type { AgentTimelineItem } from "@thoth/protocol/agent-types";

export const LIVE_HISTORY_FETCH_TIMEOUT_MS = 2_000;

interface FetchProjectedTimelineItemsInput {
  client: DaemonClient;
  agentId: string;
  timeoutMs?: number;
}

export async function fetchProjectedTimelineItems(
  input: FetchProjectedTimelineItemsInput,
): Promise<AgentTimelineItem[]> {
  let timeline = await input.client.fetchAgentTimeline(input.agentId, {
    direction: "tail",
    limit: 200,
    projection: "projected",
    timeout: input.timeoutMs,
  });
  let entries = [...timeline.entries];
  while (timeline.hasOlder && timeline.startCursor) {
    const previousCursor = timeline.startCursor;
    timeline = await input.client.fetchAgentTimeline(input.agentId, {
      direction: "before",
      cursor: previousCursor,
      limit: 200,
      projection: "projected",
      timeout: input.timeoutMs,
    });
    entries = [...timeline.entries, ...entries];
    if (
      timeline.startCursor?.epoch === previousCursor.epoch &&
      timeline.startCursor.seq === previousCursor.seq
    ) {
      throw new Error("Timeline pagination did not advance");
    }
  }
  return entries.map((entry) => entry.item);
}
