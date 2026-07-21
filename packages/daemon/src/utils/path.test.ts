import { describe, expect, test } from "vitest";

import {
  areEquivalentPaths,
  createPathEquivalenceMatcher,
  isPathInsideRoot,
} from "@thoth/drivers/internal/utils/path";

describe("path equivalence", () => {
  test.each([
    ["C:/Users/Administrator/GhostFactory", "C:\\Users\\Administrator\\GhostFactory"],
    ["d:\\Projects\\thoth", "D:\\Projects\\thoth"],
    ["C:\\Users\\Administrator\\GhostFactory\\", "C:\\Users\\Administrator\\GhostFactory"],
    [String.raw`\\?\C:\Users\Administrator\GhostFactory`, "C:\\Users\\Administrator\\GhostFactory"],
    [String.raw`\\?\UNC\server\share\GhostFactory`, String.raw`\\server\share\GhostFactory`],
  ])("matches Windows-equivalent cwd forms", (left, right) => {
    expect(areEquivalentPaths(left, right)).toBe(true);
    expect(createPathEquivalenceMatcher(left)(right)).toBe(true);
  });

  test("keeps POSIX path casing significant", () => {
    expect(
      areEquivalentPaths("/Users/Administrator/GhostFactory", "/users/administrator/ghostfactory"),
    ).toBe(false);
  });

  test("checks POSIX root containment without prefix false positives", () => {
    expect(isPathInsideRoot("/opt/thoth", "/opt/thoth/node_modules/@thoth/daemon")).toBe(true);
    expect(isPathInsideRoot("/opt/thoth", "/opt/thoth-other")).toBe(false);
  });

  test("checks Windows root containment case-insensitively", () => {
    expect(isPathInsideRoot("C:\\Thoth\\node_modules", "c:/thoth/node_modules/@thoth/daemon")).toBe(
      true,
    );
    expect(isPathInsideRoot("C:\\Thoth\\node_modules", "C:\\Thoth\\node_modules-other")).toBe(
      false,
    );
  });
});
