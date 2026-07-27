import type { ComponentType } from "react";
import type { ToolCallDetail } from "@thoth/protocol/agent-types";
import type { ToolCallDisplayInput } from "@/utils/tool-call-display";
import { buildToolCallDisplayModel } from "@/utils/tool-call-display";
import { extractToolCallFilePath } from "@/utils/extract-tool-call-file-path";
import {
  hasMeaningfulToolCallDetail,
  isPendingToolCallDetail,
} from "@/utils/tool-call-detail-state";

type ToolCallStatus = "executing" | "running" | "completed" | "failed" | "canceled";
export type ToolCallPresentationIcon = ComponentType<{ size?: number; color?: string }>;

interface BuildToolCallPresentationInput {
  toolName: string;
  status: ToolCallStatus;
  error: unknown;
  detail?: ToolCallDetail;
  cwd?: string;
  metadata?: Record<string, unknown>;
  resolveIcon: ToolCallIconResolver;
}

export interface ToolCallPresentation {
  displayName: string;
  summary?: string;
  errorText?: string;
  icon: ToolCallPresentationIcon;
  isLoadingDetails: boolean;
  hasDetails: boolean;
  canOpenDetails: boolean;
  openFilePath: string | null;
  isPlan: boolean;
  outputTruncated: boolean;
}

export type ToolCallIconResolver = (
  toolName: string,
  detail: ToolCallDetail | undefined,
) => ToolCallPresentationIcon;

function displayStatus(status: ToolCallStatus): ToolCallDisplayInput["status"] {
  return status === "executing" ? "running" : status;
}

function displayDetail(detail: ToolCallDetail | undefined): ToolCallDetail {
  return detail ?? { type: "unknown", input: null, output: null };
}

function hasCanonicalOutputTruncation(metadata: Record<string, unknown> | undefined): boolean {
  const receipt = metadata?.contentTruncation;
  return (
    typeof receipt === "object" &&
    receipt !== null &&
    "truncated" in receipt &&
    receipt.truncated === true &&
    "encoding" in receipt &&
    receipt.encoding === "utf-8"
  );
}

export function buildToolCallPresentation(
  input: BuildToolCallPresentationInput,
): ToolCallPresentation {
  const detailForDisplay = displayDetail(input.detail);
  const displayModel = buildToolCallDisplayModel({
    name: input.toolName,
    status: displayStatus(input.status),
    error: input.error ?? null,
    detail: detailForDisplay,
    metadata: input.metadata,
    cwd: input.cwd,
  });
  const isLoadingDetails = isPendingToolCallDetail({
    detail: input.detail,
    status: input.status,
    error: input.error,
  });
  const hasDetails = Boolean(input.error) || hasMeaningfulToolCallDetail(input.detail);
  const outputTruncated = hasCanonicalOutputTruncation(input.metadata);
  const summary = outputTruncated
    ? [displayModel.summary, "Output truncated"].filter(Boolean).join(" · ")
    : displayModel.summary;

  return {
    displayName: displayModel.displayName,
    summary,
    errorText: displayModel.errorText,
    icon: input.resolveIcon(input.toolName, input.detail),
    isLoadingDetails,
    hasDetails,
    canOpenDetails: hasDetails || isLoadingDetails,
    openFilePath: extractToolCallFilePath(input.detail),
    isPlan: input.detail?.type === "plan",
    outputTruncated,
  };
}
