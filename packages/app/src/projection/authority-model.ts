import type { AgentLifecycleStatus } from "@thoth/protocol/agent-lifecycle";
import type {
  AgentCapabilityFlags,
  AgentFeature,
  AgentMode,
  AgentPermissionRequest,
  AgentPersistenceHandle,
  AgentProvider,
  AgentUsage,
  ProviderQuestionProjection,
} from "@thoth/protocol/agent-types";
import type {
  AgentProviderControl,
  ProviderPlanCapability,
} from "@thoth/protocol/provider-control";
import type {
  ProjectPlacementPayload,
  WorkspaceDescriptorPayload,
  WorkspaceProjectDescriptorPayload,
} from "@thoth/protocol/messages";
import { normalizeWorkspaceOpaqueId, normalizeWorkspacePath } from "@/utils/workspace-identity";

export interface AgentRuntimeInfo {
  provider: AgentProvider;
  sessionId: string | null;
  model?: string | null;
  modeId?: string | null;
  thinkingOptionId?: string | null;
  extra?: Record<string, unknown>;
}

export interface Agent {
  serverId: string;
  id: string;
  provider: AgentProvider;
  status: AgentLifecycleStatus;
  createdAt: Date;
  updatedAt: Date;
  lastUserMessageAt: Date | null;
  lastActivityAt: Date;
  capabilities: AgentCapabilityFlags;
  planCapability?: ProviderPlanCapability;
  providerControl?: AgentProviderControl;
  currentModeId: string | null;
  availableModes: AgentMode[];
  pendingPermissions: AgentPermissionRequest[];
  pendingProviderQuestions: ProviderQuestionProjection[];
  persistence: AgentPersistenceHandle | null;
  runtimeInfo?: AgentRuntimeInfo;
  lastUsage?: AgentUsage;
  lastError?: string | null;
  title: string | null;
  cwd: string;
  workspaceId?: string;
  model: string | null;
  features?: AgentFeature[];
  thinkingOptionId?: string | null;
  requiresAttention?: boolean;
  attentionReason?: "finished" | "error" | "permission" | null;
  attentionTimestamp?: Date | null;
  archivedAt?: Date | null;
  parentAgentId: string | null;
  labels: Record<string, string>;
  projectPlacement?: ProjectPlacementPayload | null;
}

export interface WorkspaceDescriptor {
  id: string;
  projectId: string;
  projectDisplayName: string;
  projectCustomName?: string | null;
  projectRootPath: string;
  workspaceDirectory: string;
  projectKind: WorkspaceDescriptorPayload["projectKind"];
  workspaceKind: WorkspaceDescriptorPayload["workspaceKind"];
  name: string;
  title?: string | null;
  status: WorkspaceDescriptorPayload["status"];
  statusEnteredAt: Date | null;
  archivingAt: string | null;
  diffStat: { additions: number; deletions: number } | null;
  scripts: WorkspaceDescriptorPayload["scripts"];
  gitRuntime?: WorkspaceDescriptorPayload["gitRuntime"];
  githubRuntime?: WorkspaceDescriptorPayload["githubRuntime"];
  project?: ProjectPlacementPayload;
}

export interface EmptyProjectDescriptor {
  projectId: string;
  projectDisplayName: string;
  projectCustomName: string | null;
  projectRootPath: string;
  projectKind: WorkspaceDescriptorPayload["projectKind"];
}

export function normalizeWorkspaceDescriptor(
  payload: WorkspaceDescriptorPayload,
): WorkspaceDescriptor {
  const statusEnteredAtRaw = payload.statusEnteredAt;
  return {
    id: normalizeWorkspaceOpaqueId(payload.id) ?? payload.id,
    projectId: payload.projectId,
    projectDisplayName: payload.projectDisplayName,
    projectCustomName: payload.projectCustomName ?? null,
    projectRootPath: payload.projectRootPath,
    workspaceDirectory: normalizeWorkspacePath(payload.workspaceDirectory) ?? "",
    projectKind: payload.projectKind,
    workspaceKind: payload.workspaceKind,
    name: payload.name,
    title: payload.title ?? null,
    status: payload.status,
    statusEnteredAt:
      typeof statusEnteredAtRaw === "string" && statusEnteredAtRaw.length > 0
        ? new Date(statusEnteredAtRaw)
        : null,
    archivingAt: payload.archivingAt ?? null,
    diffStat: payload.diffStat ?? null,
    scripts: (payload.scripts ?? []).map((script) => ({ ...script })),
    gitRuntime: payload.gitRuntime,
    githubRuntime: payload.githubRuntime,
    project: payload.project,
  };
}

export function normalizeEmptyProjectDescriptor(
  payload: WorkspaceProjectDescriptorPayload,
): EmptyProjectDescriptor {
  return {
    projectId: payload.projectId,
    projectDisplayName: payload.projectDisplayName,
    projectCustomName: payload.projectCustomName ?? null,
    projectRootPath: payload.projectRootPath,
    projectKind: payload.projectKind,
  };
}
