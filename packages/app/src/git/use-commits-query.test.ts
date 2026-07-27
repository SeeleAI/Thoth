import { describe, expect, it } from "vitest";
import { classifyCheckoutCommits, resolveCheckoutCommitsQueryResult } from "./use-commits-query";

describe("checkout commit history query state", () => {
  it("does not call an old host without both advertised semantic capabilities", () => {
    expect(
      resolveCheckoutCommitsQueryResult({
        enabled: true,
        capabilityPresent: false,
        canFetch: true,
        data: undefined,
        error: null,
      }),
    ).toEqual({ status: "unsupported" });
  });

  it("requires daemon-authored base classification", () => {
    expect(() =>
      classifyCheckoutCommits({
        baseRef: "main",
        commits: [
          {
            sha: "1".repeat(40),
            shortSha: "1111111",
            subject: "Unclassified",
            authorName: "Test User",
            authorDate: "2026-07-27T00:00:00Z",
            isOnRemote: false,
            files: [],
          },
        ],
      }),
    ).toThrow("Host omitted commit base classification");
  });
});
