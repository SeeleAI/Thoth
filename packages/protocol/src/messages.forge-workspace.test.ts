import { describe, expect, test } from "vitest";
import { rpcRegistry } from "./messages.js";

describe("Forge and Workspace lifecycle RPC contracts", () => {
  test("parses Forge resolution and clone requests without credentials", () => {
    expect(
      rpcRegistry.operationForRequestType("forge.resolve.request")?.input.parse({
        type: "forge.resolve.request",
        requestId: "resolve-1",
        remoteUrl: "git@gitlab.com:acme/widgets.git",
      }),
    ).toMatchObject({ type: "forge.resolve.request" });
    expect(
      rpcRegistry.operationForRequestType("workspace.clone.request")?.input.parse({
        type: "workspace.clone.request",
        requestId: "clone-1",
        remoteUrl: "https://codeberg.org/acme/widgets.git",
        destinationPath: "/work/widgets",
      }),
    ).toMatchObject({ type: "workspace.clone.request" });
  });

  test("parses explicit Workspace restore authority", () => {
    expect(
      rpcRegistry.operationForRequestType("workspace.restore.request")?.input.parse({
        type: "workspace.restore.request",
        requestId: "restore-1",
        workspaceId: "workspace-1",
      }),
    ).toMatchObject({ type: "workspace.restore.request" });
  });
});
