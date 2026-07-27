import { skipToken, useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import type { CheckoutCommitFile, ParsedDiffFile } from "@thoth/protocol/messages";
import { checkoutCommitFileDiffQueryKey, COMMIT_FILE_DIFF_STALE_TIME } from "@/git/query-keys";
import { useCheckoutCommitsQuery } from "@/git/use-commits-query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export function resolveCommitDiffFile(
  file: CheckoutCommitFile,
  resolved: ParsedDiffFile | null | undefined,
): ParsedDiffFile | null {
  if (resolved) return resolved;
  if (resolved === undefined) return null;
  return {
    path: file.path,
    isNew: file.status === "added",
    isDeleted: file.status === "deleted",
    additions: file.additions,
    deletions: file.deletions,
    hunks: [],
    status: "binary",
  };
}

export function resolveCommitDiffFiles(
  files: CheckoutCommitFile[],
  resolvedByPath: ReadonlyMap<string, ParsedDiffFile | null | undefined>,
): ParsedDiffFile[] {
  return files.flatMap((file) => {
    const resolved = resolveCommitDiffFile(file, resolvedByPath.get(file.path));
    return resolved ? [resolved] : [];
  });
}

export function useCommitDiffFiles(options: {
  serverId: string;
  cwd: string;
  sha: string | null;
  enabled?: boolean;
}) {
  const { serverId, cwd, sha, enabled = true } = options;
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const commitsQuery = useCheckoutCommitsQuery({ serverId, cwd, enabled });
  const selectedCommit = useMemo(() => {
    if (!sha || commitsQuery.status !== "loaded") return null;
    return commitsQuery.data.commits.find((commit) => commit.sha === sha) ?? null;
  }, [commitsQuery, sha]);
  const commitFiles = selectedCommit?.files ?? [];
  const shouldFetch =
    enabled && Boolean(sha) && Boolean(client) && isConnected && commitsQuery.status === "loaded";
  const fileDiffResults = useQueries({
    queries: commitFiles.map((file) => ({
      queryKey: checkoutCommitFileDiffQueryKey(serverId, cwd, sha ?? "", file.path),
      queryFn:
        shouldFetch && client && sha
          ? () => client.getCommitFileDiff(cwd, sha, file.path)
          : skipToken,
      staleTime: COMMIT_FILE_DIFF_STALE_TIME,
    })),
  });

  return useMemo(() => {
    const resolvedByPath = new Map<string, ParsedDiffFile | null | undefined>();
    commitFiles.forEach((file, index) => {
      resolvedByPath.set(file.path, fileDiffResults[index]?.data?.file);
    });
    const commitsLoading =
      commitsQuery.status === "loading" || commitsQuery.status === "connecting";
    const commitsError = commitsQuery.status === "error" ? commitsQuery.error : null;
    const fileError = fileDiffResults.find((result) => result.error)?.error ?? null;
    return {
      files: resolveCommitDiffFiles(commitFiles, resolvedByPath),
      isLoading: commitsLoading || fileDiffResults.some((result) => result.isLoading),
      error: commitsError ?? fileError,
      capabilityMissing: commitsQuery.status === "unsupported",
      commit: selectedCommit,
    };
  }, [commitFiles, commitsQuery, fileDiffResults, selectedCommit]);
}
