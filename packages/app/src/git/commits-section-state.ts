import type { ClassifiedCheckoutCommit } from "./use-commits-query";

export function selectWorkspaceCommits(commits: ClassifiedCheckoutCommit[]) {
  return commits.filter((commit) => !commit.isOnBase);
}
