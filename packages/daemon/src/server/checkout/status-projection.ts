import type {
  CheckoutPrStatusResponse,
  CheckoutStatusResponse,
  SessionOutboundMessage,
} from "@thoth/protocol/messages";
import type { WorkspaceGitRuntimeSnapshot } from "../workspace-git-service.js";
import { resolveForgeRepository } from "@thoth/protocol/forge";

type CheckoutPrStatusPayload = Extract<
  SessionOutboundMessage,
  { type: "checkout_pr_status_response" }
>["payload"];
type CheckoutPrStatusPayloadStatus = NonNullable<CheckoutPrStatusPayload["status"]>;

export function buildCheckoutStatusPayloadFromSnapshot({
  cwd,
  requestId,
  snapshot,
}: {
  cwd: string;
  requestId: string;
  snapshot: WorkspaceGitRuntimeSnapshot;
}): CheckoutStatusResponse["payload"] {
  if (!snapshot.git.isGit) {
    return {
      cwd,
      forge: null,
      isGit: false,
      repoRoot: null,
      currentBranch: null,
      isDirty: null,
      baseRef: null,
      aheadBehind: null,
      aheadOfOrigin: null,
      behindOfOrigin: null,
      hasRemote: false,
      remoteUrl: null,
      isThothOwnedWorktree: false,
      error: null,
      requestId,
    };
  }

  if (snapshot.git.repoRoot === null || snapshot.git.isDirty === null) {
    throw new Error("Workspace git snapshot is missing required checkout status fields");
  }

  const forge = snapshot.git.remoteUrl ? resolveForgeRepository(snapshot.git.remoteUrl) : null;

  if (snapshot.git.isThothOwnedWorktree) {
    if (snapshot.git.mainRepoRoot === null || snapshot.git.baseRef === null) {
      throw new Error("Workspace git snapshot is missing required worktree status fields");
    }

    return {
      cwd,
      forge,
      isGit: true,
      repoRoot: snapshot.git.repoRoot,
      mainRepoRoot: snapshot.git.mainRepoRoot,
      currentBranch: snapshot.git.currentBranch ?? null,
      isDirty: snapshot.git.isDirty,
      baseRef: snapshot.git.baseRef,
      aheadBehind: snapshot.git.aheadBehind ?? null,
      aheadOfOrigin: snapshot.git.aheadOfOrigin ?? null,
      behindOfOrigin: snapshot.git.behindOfOrigin ?? null,
      hasRemote: snapshot.git.hasRemote,
      remoteUrl: snapshot.git.remoteUrl,
      isThothOwnedWorktree: true,
      error: null,
      requestId,
    };
  }

  return {
    cwd,
    forge,
    isGit: true,
    repoRoot: snapshot.git.repoRoot,
    mainRepoRoot: snapshot.git.mainRepoRoot,
    currentBranch: snapshot.git.currentBranch ?? null,
    isDirty: snapshot.git.isDirty,
    baseRef: snapshot.git.baseRef ?? null,
    aheadBehind: snapshot.git.aheadBehind ?? null,
    aheadOfOrigin: snapshot.git.aheadOfOrigin ?? null,
    behindOfOrigin: snapshot.git.behindOfOrigin ?? null,
    hasRemote: snapshot.git.hasRemote,
    remoteUrl: snapshot.git.remoteUrl,
    isThothOwnedWorktree: false,
    error: null,
    requestId,
  };
}

export function buildCheckoutPrStatusPayloadFromSnapshot({
  cwd,
  requestId,
  snapshot,
}: {
  cwd: string;
  requestId: string;
  snapshot: WorkspaceGitRuntimeSnapshot;
}): CheckoutPrStatusResponse["payload"] {
  return {
    cwd,
    forge: snapshot.git.remoteUrl ? resolveForgeRepository(snapshot.git.remoteUrl) : null,
    status: normalizeCheckoutPrStatusPayload(snapshot.github.pullRequest),
    githubFeaturesEnabled: snapshot.github.featuresEnabled,
    error: snapshot.github.error
      ? {
          code: "UNKNOWN",
          message: snapshot.github.error.message,
        }
      : null,
    requestId,
  };
}

export function normalizeCheckoutPrStatusPayload(
  status: WorkspaceGitRuntimeSnapshot["github"]["pullRequest"],
): CheckoutPrStatusPayloadStatus | null {
  if (!status) {
    return null;
  }
  const payload: CheckoutPrStatusPayloadStatus = {
    number: status.number,
    url: status.url,
    title: status.title,
    state: status.state,
    repoOwner: status.repoOwner,
    repoName: status.repoName,
    baseRefName: status.baseRefName,
    headRefName: status.headRefName,
    isMerged: status.isMerged,
    isDraft: status.isDraft ?? false,
    mergeable: status.mergeable ?? "UNKNOWN",
    checks: status.checks ?? [],
    checksStatus: status.checksStatus,
    reviewDecision: status.reviewDecision,
  };
  if (status.github) {
    payload.github = status.github;
  }
  return payload;
}
