import { describe, expect, test } from "vitest";

import { CheckoutPrStatusSchema } from "@thoth/protocol/messages";
import type { WorkspaceGitRuntimeSnapshot } from "../workspace-git-service.js";
import {
  buildCheckoutPrStatusPayloadFromSnapshot,
  buildCheckoutStatusPayloadFromSnapshot,
  normalizeCheckoutPrStatusPayload,
} from "./status-projection.js";

describe("checkout status projection", () => {
  test("projects GitLab Forge identity into checkout and change-request status", () => {
    const snapshot: WorkspaceGitRuntimeSnapshot = {
      cwd: "/work/widgets",
      git: {
        isGit: true,
        repoRoot: "/work/widgets",
        mainRepoRoot: null,
        currentBranch: "feature/widgets",
        remoteUrl: "git@gitlab.com:acme/platform/widgets.git",
        isThothOwnedWorktree: false,
        isDirty: false,
        baseRef: "origin/main",
        aheadBehind: { ahead: 1, behind: 0 },
        aheadOfOrigin: 0,
        behindOfOrigin: 0,
        hasRemote: true,
        diffStat: null,
      },
      github: { featuresEnabled: false, pullRequest: null, error: null },
    };

    expect(
      buildCheckoutStatusPayloadFromSnapshot({
        cwd: snapshot.cwd,
        requestId: "checkout-status",
        snapshot,
      }).forge,
    ).toMatchObject({ forge: "gitlab", fullName: "acme/platform/widgets" });
    expect(
      buildCheckoutPrStatusPayloadFromSnapshot({
        cwd: snapshot.cwd,
        requestId: "change-request-status",
        snapshot,
      }).forge,
    ).toMatchObject({ forge: "gitlab", changeRequestAbbrev: "MR" });
  });

  test("includes repository identity fields on the PR status wire payload", () => {
    const payload = normalizeCheckoutPrStatusPayload({
      number: 123,
      repoOwner: "internal-owner",
      repoName: "internal-repo",
      url: "https://github.com/thoth/thoth/pull/123",
      title: "Ship PR pane",
      state: "open",
      baseRefName: "main",
      headRefName: "feature/pr-pane",
      isMerged: false,
      isDraft: true,
      mergeable: "MERGEABLE",
      checks: [
        {
          name: "typecheck",
          status: "success",
          url: "https://github.com/thoth/thoth/actions/runs/1",
          workflow: "CI",
          duration: "1m 20s",
        },
      ],
      checksStatus: "success",
      reviewDecision: "approved",
    });

    expect(payload).toHaveProperty("repoOwner", "internal-owner");
    expect(payload).toHaveProperty("repoName", "internal-repo");
    expect(payload).toHaveProperty("mergeable", "MERGEABLE");
    expect(CheckoutPrStatusSchema.parse(payload)).toEqual(payload);
  });

  test("projects PR 993 GitHub merge facts without changing top-level status fields", () => {
    const payload = normalizeCheckoutPrStatusPayload({
      number: 993,
      repoOwner: "thoth",
      repoName: "thoth",
      url: "https://github.com/thoth/thoth/pull/993",
      title: "Auto-merge UX",
      state: "open",
      baseRefName: "main",
      headRefName: "github-pr-auto-merge-ux",
      isMerged: false,
      isDraft: false,
      mergeable: "MERGEABLE",
      checks: [
        {
          name: "server tests",
          status: "pending",
          url: "https://github.com/thoth/thoth/actions/runs/993",
          workflow: "CI",
        },
      ],
      checksStatus: "pending",
      reviewDecision: "approved",
      github: {
        mergeStateStatus: "BLOCKED",
        autoMergeRequest: null,
        viewerCanEnableAutoMerge: true,
        viewerCanDisableAutoMerge: false,
        viewerCanMergeAsAdmin: false,
        viewerCanUpdateBranch: true,
        repository: {
          autoMergeAllowed: true,
          mergeCommitAllowed: false,
          squashMergeAllowed: true,
          rebaseMergeAllowed: false,
          viewerDefaultMergeMethod: "SQUASH",
        },
        isMergeQueueEnabled: false,
        isInMergeQueue: false,
      },
    });

    expect(payload).toMatchObject({
      number: 993,
      mergeable: "MERGEABLE",
      checksStatus: "pending",
      github: {
        mergeStateStatus: "BLOCKED",
        viewerCanEnableAutoMerge: true,
        repository: {
          autoMergeAllowed: true,
          squashMergeAllowed: true,
          viewerDefaultMergeMethod: "SQUASH",
        },
      },
    });
    expect(CheckoutPrStatusSchema.parse(payload)).toEqual(payload);
  });
});
