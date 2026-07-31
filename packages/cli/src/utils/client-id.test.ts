import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { resolveCliClientIdPath } from "./client-id.js";

describe("resolveCliClientIdPath", () => {
  it("treats an empty THOTH_HOME as unset instead of using the current directory", () => {
    expect(resolveCliClientIdPath({ THOTH_HOME: "" }, "/home/thoth-user")).toBe(
      join("/home/thoth-user", ".thoth", "cli-client-id"),
    );
  });

  it("uses an explicit Thoth home", () => {
    expect(resolveCliClientIdPath({ THOTH_HOME: "/tmp/isolated-thoth" }, "/home/ignored")).toBe(
      join("/tmp/isolated-thoth", "cli-client-id"),
    );
  });
});
