import { describe, expect, it } from "vitest";
import { resolveWebScrollbarGutter } from "./use-web-scrollbar";

describe("resolveWebScrollbarGutter", () => {
  it("reserves stable textarea width only for explicitly opted-in consumers", () => {
    expect(resolveWebScrollbarGutter(false)).toBe("auto");
    expect(resolveWebScrollbarGutter(true)).toBe("stable");
  });
});
