import {
  deriveAgentStateBucket,
  getWorkspaceStateBucketPriority,
} from "@thoth/protocol/agent-state-bucket";
import type { Agent, WorkspaceDescriptor } from "@/projection/authority-model";
import type { HostServerInfo } from "@/runtime/host-runtime";
import { normalizeAgentSnapshot } from "@/utils/agent-snapshots";
import type { AgentDirectorySnapshotEntry } from "@/utils/agent-directory-sync";
import { resolveProjectPlacement } from "@/utils/project-placement";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";

export interface LegacyDaemonWorkspaceSnapshot {
  agents: Map<string, Agent>;
  workspaces: Map<string, WorkspaceDescriptor>;
}

export function shouldUseLegacyDaemonWorkspaceDirectory(
  serverInfo: HostServerInfo | null | undefined,
): boolean {
  return Boolean(serverInfo && serverInfo.features?.workspaceMultiplicity !== true);
}

export function buildLegacyDaemonWorkspaceSnapshot(input: {
  serverId: string;
  entries: AgentDirectorySnapshotEntry[];
}): LegacyDaemonWorkspaceSnapshot {
  const entries = stampWorkspaceIds(input.entries);
  const agents = new Map<string, Agent>();
  for (const entry of entries) {
    const normalized = normalizeAgentSnapshot(entry.agent, input.serverId);
    agents.set(normalized.id, {
      ...normalized,
      projectPlacement: resolveProjectPlacement({
        projectPlacement: entry.project,
        cwd: normalized.cwd,
      }),
    });
  }
  return { agents, workspaces: buildLegacyWorkspaces(entries) };
}

function stampWorkspaceIds(entries: AgentDirectorySnapshotEntry[]): AgentDirectorySnapshotEntry[] {
  return entries.map((entry) => ({
    ...entry,
    agent: { ...entry.agent, workspaceId: resolveWorkspaceId(entry) },
  }));
}

function buildLegacyWorkspaces(
  entries: AgentDirectorySnapshotEntry[],
): Map<string, WorkspaceDescriptor> {
  const workspaces = new Map<string, WorkspaceDescriptor>();
  for (const entry of entries) {
    const workspaceId = entry.agent.workspaceId ?? resolveWorkspaceId(entry);
    const status = deriveAgentStateBucket({
      status: entry.agent.status,
      pendingPermissionCount: entry.agent.pendingPermissions.length,
      requiresAttention: entry.agent.requiresAttention,
      attentionReason: entry.agent.attentionReason,
    });
    const statusEnteredAt = parseAgentTimestamp(entry);
    const existing = workspaces.get(workspaceId);
    if (!existing) {
      workspaces.set(workspaceId, createLegacyWorkspace(entry, status, statusEnteredAt));
    } else if (
      getWorkspaceStateBucketPriority(status) < getWorkspaceStateBucketPriority(existing.status)
    ) {
      workspaces.set(workspaceId, { ...existing, status, statusEnteredAt });
    }
  }
  return workspaces;
}

function createLegacyWorkspace(
  entry: AgentDirectorySnapshotEntry,
  status: WorkspaceDescriptor["status"],
  statusEnteredAt: Date | null,
): WorkspaceDescriptor {
  const workspaceDirectory = resolveWorkspaceId(entry);
  const checkout = entry.project.checkout;
  const projectRootPath =
    normalizeWorkspacePath(checkout.mainRepoRoot ?? checkout.worktreeRoot ?? checkout.cwd) ??
    workspaceDirectory;
  return {
    id: workspaceDirectory,
    projectId: entry.project.projectKey,
    projectDisplayName: entry.project.projectName,
    projectCustomName: null,
    projectRootPath,
    workspaceDirectory,
    projectKind: checkout.isGit ? "git" : "non_git",
    workspaceKind: checkout.isGit
      ? checkout.isThothOwnedWorktree
        ? "worktree"
        : "checkout"
      : "directory",
    name:
      entry.project.workspaceName?.trim() ||
      (checkout.currentBranch && checkout.currentBranch !== "HEAD"
        ? checkout.currentBranch
        : workspaceDirectoryName(workspaceDirectory)),
    title: null,
    status,
    statusEnteredAt,
    archivingAt: null,
    diffStat: null,
    scripts: [],
    gitRuntime: checkout.isGit
      ? {
          forge: null,
          currentBranch: checkout.currentBranch,
          remoteUrl: checkout.remoteUrl,
          isThothOwnedWorktree: checkout.isThothOwnedWorktree,
          isDirty: null,
          aheadBehind: null,
          aheadOfOrigin: null,
          behindOfOrigin: null,
        }
      : null,
    githubRuntime: null,
    project: entry.project,
  };
}

function resolveWorkspaceId(entry: AgentDirectorySnapshotEntry): string {
  return (
    normalizeWorkspacePath(entry.project.checkout.cwd) ??
    normalizeWorkspacePath(entry.agent.cwd) ??
    entry.agent.cwd
  );
}

function workspaceDirectoryName(directory: string): string {
  const trimmed = directory.trim().replace(/[/]+$/g, "");
  const separator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return separator >= 0 ? trimmed.slice(separator + 1) : trimmed;
}

function parseAgentTimestamp(entry: AgentDirectorySnapshotEntry): Date | null {
  const value = entry.agent.attentionTimestamp ?? entry.agent.updatedAt;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
