import { afterEach, describe, expect, it } from "vitest";
import {
  requireWorkspaceScriptWorkspaceId,
  responseError,
  workspaceScriptCommandError,
} from "./shared.js";

describe("Workspace script CLI authority", () => {
  const originalWorkspaceId = process.env.THOTH_WORKSPACE_ID;

  afterEach(() => {
    if (originalWorkspaceId === undefined) delete process.env.THOTH_WORKSPACE_ID;
    else process.env.THOTH_WORKSPACE_ID = originalWorkspaceId;
  });

  it("requires one explicit Workspace authority scope", () => {
    delete process.env.THOTH_WORKSPACE_ID;
    expect(() => requireWorkspaceScriptWorkspaceId({})).toThrowError(
      expect.objectContaining({ code: "WORKSPACE_REQUIRED" }),
    );
    expect(requireWorkspaceScriptWorkspaceId({ workspace: " workspace-1 " })).toBe("workspace-1");
  });

  it("preserves daemon typed error codes for automation", () => {
    const error = responseError({
      fallbackCode: "WORKSPACE_SCRIPT_START_FAILED",
      errorCode: "stale_generation",
      message: "The runtime generation is stale",
    });
    expect(error).toEqual({
      code: "STALE_GENERATION",
      message: "The runtime generation is stale",
    });
    expect(workspaceScriptCommandError("FALLBACK", "start", error)).toBe(error);
  });
});
