import type {
  AgentTimelineContentTruncationReceipt,
  AgentTimelineItem,
  ToolCallDetail,
  ToolCallTimelineItem,
} from "@thoth/drivers/agent-runtime";

export const AGENT_TIMELINE_TOOL_CONTENT_LIMIT_BYTES = 64 * 1024;

class Utf8ContentBudget {
  originalBytes = 0;
  retainedBytes = 0;
  truncated = false;

  take(value: string): string {
    const originalBytes = Buffer.byteLength(value, "utf8");
    this.originalBytes += originalBytes;
    const remaining = Math.max(0, AGENT_TIMELINE_TOOL_CONTENT_LIMIT_BYTES - this.retainedBytes);
    if (originalBytes <= remaining) {
      this.retainedBytes += originalBytes;
      return value;
    }
    const retained = utf8Prefix(value, remaining);
    this.retainedBytes += Buffer.byteLength(retained, "utf8");
    this.truncated = true;
    return retained;
  }
}

export function limitAgentTimelineItemContent(item: AgentTimelineItem): AgentTimelineItem {
  if (item.type !== "tool_call") return item;

  const budget = new Utf8ContentBudget();
  const detail = limitToolCallDetail(item.detail, budget);
  const error = limitToolCallError(item.error, budget);
  const sanitizedMetadata = stripReservedReceipt(item.metadata);

  if (!budget.truncated) {
    if (sanitizedMetadata === item.metadata && detail === item.detail && error === item.error) {
      return item;
    }
    return {
      ...item,
      detail,
      error,
      ...(sanitizedMetadata ? { metadata: sanitizedMetadata } : { metadata: undefined }),
    } as AgentTimelineItem;
  }

  const receipt: AgentTimelineContentTruncationReceipt = {
    truncated: true,
    encoding: "utf-8",
    strategy: "prefix",
    originalBytes: budget.originalBytes,
    retainedBytes: budget.retainedBytes,
    limitBytes: AGENT_TIMELINE_TOOL_CONTENT_LIMIT_BYTES,
  };
  return {
    ...item,
    detail,
    error,
    metadata: {
      ...(sanitizedMetadata ?? {}),
      contentTruncation: receipt,
    },
  } as AgentTimelineItem;
}

function limitToolCallDetail(detail: ToolCallDetail, budget: Utf8ContentBudget): ToolCallDetail {
  switch (detail.type) {
    case "shell":
      return typeof detail.output === "string"
        ? { ...detail, output: budget.take(detail.output) }
        : detail;
    case "read":
      return typeof detail.content === "string"
        ? { ...detail, content: budget.take(detail.content) }
        : detail;
    case "edit": {
      let changed = false;
      const next = { ...detail };
      for (const key of ["unifiedDiff", "oldString", "newString"] as const) {
        const value = detail[key];
        if (typeof value !== "string") continue;
        next[key] = budget.take(value);
        changed ||= next[key] !== value;
      }
      return changed ? next : detail;
    }
    case "write":
      return typeof detail.content === "string"
        ? { ...detail, content: budget.take(detail.content) }
        : detail;
    case "search":
      return typeof detail.content === "string"
        ? {
            ...detail,
            content: budget.take(detail.content),
            ...(budget.truncated ? { truncated: true } : {}),
          }
        : detail;
    case "fetch":
      return typeof detail.result === "string"
        ? { ...detail, result: budget.take(detail.result) }
        : detail;
    case "worktree_setup": {
      const log = budget.take(detail.log);
      const commands = detail.commands.map((command) => ({
        ...command,
        log: budget.take(command.log),
      }));
      return {
        ...detail,
        log,
        commands,
        ...(budget.truncated ? { truncated: true } : {}),
      };
    }
    case "sub_agent":
      return { ...detail, log: budget.take(detail.log) };
    case "plain_text":
      return typeof detail.text === "string"
        ? { ...detail, text: budget.take(detail.text) }
        : detail;
    case "plan":
      return { ...detail, text: budget.take(detail.text) };
    case "unknown":
      return { ...detail, output: limitUnknownValue(detail.output, budget) };
  }
}

function limitToolCallError(
  error: ToolCallTimelineItem["error"],
  budget: Utf8ContentBudget,
): ToolCallTimelineItem["error"] {
  if (typeof error === "string") return budget.take(error);
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const record = error as Record<string, unknown>;
    if (typeof record.content === "string") {
      return { ...record, content: budget.take(record.content) };
    }
  }
  return limitUnknownValue(error, budget);
}

function limitUnknownValue(value: unknown, budget: Utf8ContentBudget): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return budget.take(value);
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = "[unserializable tool output]";
  }
  const limited = budget.take(serialized);
  return limited === serialized ? value : { truncated: true, preview: limited };
}

function stripReservedReceipt(
  metadata: ToolCallTimelineItem["metadata"],
): ToolCallTimelineItem["metadata"] {
  if (!metadata || !("contentTruncation" in metadata)) return metadata;
  const next = { ...metadata };
  delete next.contentTruncation;
  return Object.keys(next).length > 0 ? next : undefined;
}

function utf8Prefix(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maxBytes) return value;
  let end = maxBytes;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}
