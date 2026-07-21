import { describe, expect, it } from "vitest";
import { ChatListRequestSchema } from "./rpc-schemas.js";

describe("Workspace-scoped chat RPC", () => {
  it("requires an explicit Workspace authority scope", () => {
    expect(
      ChatListRequestSchema.safeParse({ type: "chat/list", requestId: "request-1" }).success,
    ).toBe(false);
    expect(
      ChatListRequestSchema.parse({
        type: "chat/list",
        requestId: "request-1",
        workspaceId: "workspace-1",
      }).workspaceId,
    ).toBe("workspace-1");
  });
});
