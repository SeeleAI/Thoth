import { describe, expect, it } from "vitest";

import { CreateTerminalRequestSchema } from "./messages.js";

describe("create terminal viewport compatibility", () => {
  const base = {
    type: "create_terminal_request" as const,
    cwd: "/workspace",
    workspaceId: "workspace-1",
    requestId: "request-1",
  };

  it("keeps older requests without an initial viewport parseable", () => {
    expect(CreateTerminalRequestSchema.parse(base)).toEqual(base);
  });

  it("accepts a positive initial PTY viewport", () => {
    expect(
      CreateTerminalRequestSchema.parse({
        ...base,
        size: { rows: 48, cols: 160 },
      }),
    ).toMatchObject({ size: { rows: 48, cols: 160 } });
  });

  it("rejects non-positive viewport dimensions", () => {
    expect(
      CreateTerminalRequestSchema.safeParse({
        ...base,
        size: { rows: 0, cols: 160 },
      }).success,
    ).toBe(false);
  });
});
