import { describe, expect, it } from "vitest";

import {
  buildStringCommandShellInvocation,
  createStringCommandShellEnv,
  createStringCommandShellEnvOverlay,
} from "./string-command-shell.js";

describe("buildStringCommandShellInvocation", () => {
  it("uses a non-login bash command on unix platforms", () => {
    expect(
      buildStringCommandShellInvocation({
        command: 'echo "hello"',
        platform: "darwin",
      }),
    ).toEqual({
      shell: "bash",
      args: ["-c", 'echo "hello"'],
    });
  });

  it("removes BASH_ENV from full and overlay environments", () => {
    expect(createStringCommandShellEnv({ PATH: "/bin", BASH_ENV: "/tmp/injected" })).toEqual({
      PATH: "/bin",
    });
    expect(createStringCommandShellEnvOverlay()).toEqual({ BASH_ENV: undefined });
  });

  it("uses powershell command semantics on windows", () => {
    expect(
      buildStringCommandShellInvocation({
        command: "Write-Output 'hello'",
        platform: "win32",
      }),
    ).toEqual({
      shell: "powershell",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "Write-Output 'hello'",
      ],
    });
  });
});
