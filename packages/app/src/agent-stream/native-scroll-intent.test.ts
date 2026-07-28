import { describe, expect, it } from "vitest";
import { shouldIgnoreMomentumEnd } from "./native-scroll-intent";

describe("native stream scroll intent", () => {
  it("ignores a late momentum end after programmatic bottom anchoring released user intent", () => {
    expect(shouldIgnoreMomentumEnd(false)).toBe(true);
    expect(shouldIgnoreMomentumEnd(true)).toBe(false);
  });
});
