import type { ExecutionService } from "./execution-service.js";
import type { AgentTimelineItem } from "@thoth/drivers/agent-runtime";

export interface AppendTimelineItemIfAgentKnownOptions {
  executionService: ExecutionService;
  agentId: string;
  item: AgentTimelineItem;
}

export async function appendTimelineItemIfAgentKnown(
  options: AppendTimelineItemIfAgentKnownOptions,
): Promise<boolean> {
  try {
    await options.executionService.appendTimelineItem(options.agentId, options.item);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Unknown agent")) {
      return false;
    }
    throw error;
  }
}

export async function emitLiveTimelineItemIfAgentKnown(
  options: AppendTimelineItemIfAgentKnownOptions,
): Promise<boolean> {
  try {
    await options.executionService.emitLiveTimelineItem(options.agentId, options.item);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Unknown agent")) {
      return false;
    }
    throw error;
  }
}
