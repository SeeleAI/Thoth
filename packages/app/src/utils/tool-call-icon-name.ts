import type { ToolCallDetail, ToolCallIconName } from "@thoth/protocol/agent-types";
import { isThothToolName } from "@thoth/protocol/tool-name-normalization";

export type ToolCallIcon = ToolCallIconName | "thoth";

const TOOL_DETAIL_ICON_NAMES: Record<ToolCallDetail["type"], ToolCallIcon> = {
  shell: "square_terminal",
  read: "eye",
  edit: "pencil",
  write: "pencil",
  search: "search",
  fetch: "search",
  worktree_setup: "square_terminal",
  sub_agent: "bot",
  plain_text: "wrench",
  plan: "brain",
  unknown: "wrench",
};

export function resolveToolCallIconName(toolName: string, detail?: ToolCallDetail): ToolCallIcon {
  const lowerName = toolName.trim().toLowerCase();

  if (detail?.type === "plain_text" && detail.icon) {
    return detail.icon;
  }

  // Thoughts are rendered through ToolCall with unknown detail payloads.
  if (lowerName === "thinking" && (!detail || detail.type === "unknown")) {
    return "brain";
  }
  if (isThothToolName(lowerName)) {
    return "thoth";
  }
  if (lowerName === "task") {
    return "bot";
  }

  if (detail) {
    return TOOL_DETAIL_ICON_NAMES[detail.type];
  }
  return "wrench";
}
