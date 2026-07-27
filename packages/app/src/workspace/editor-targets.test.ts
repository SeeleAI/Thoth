import { describe, expect, it } from "vitest";
import { isKnownEditorTargetId } from "./editor-targets";

describe("editor target ids", () => {
  it("recognizes built-ins without typing custom ids out of the system", () => {
    const customEditorId: string = "script:open-in-nvim";

    expect(isKnownEditorTargetId("vscode")).toBe(true);
    expect(isKnownEditorTargetId("vscode-insiders")).toBe(true);
    expect(isKnownEditorTargetId("vscodium")).toBe(true);
    expect(isKnownEditorTargetId("trae")).toBe(true);
    expect(isKnownEditorTargetId("kiro")).toBe(true);
    expect(isKnownEditorTargetId("intellij-idea")).toBe(true);
    expect(isKnownEditorTargetId("pycharm")).toBe(true);
    expect(isKnownEditorTargetId("rustrover")).toBe(true);
    expect(isKnownEditorTargetId(customEditorId)).toBe(false);
  });
});
