import { EventEmitter } from "node:events";
import { afterEach, describe, expect, test, vi } from "vitest";

import { terminateWithTreeKill, type TreeKillTarget } from "./tree-kill.js";

class ProcessTarget extends EventEmitter implements TreeKillTarget {
  pid = 4242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  kill = vi.fn(() => true);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe.skipIf(process.platform === "win32")("POSIX provider termination", () => {
  test("signals the provider process group without invoking a host process utility", async () => {
    const child = new ProcessTarget();
    const processKill = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      expect(pid).toBe(-child.pid);
      expect(signal).toBe("SIGTERM");
      child.exitCode = 0;
      queueMicrotask(() => child.emit("exit"));
      return true;
    });

    await expect(
      terminateWithTreeKill(child, {
        gracefulTimeoutMs: 100,
        forceTimeoutMs: 100,
      }),
    ).resolves.toBe("terminated");
    expect(processKill).toHaveBeenCalledOnce();
    expect(child.kill).not.toHaveBeenCalled();
  });

  test("falls back to the direct child handle when no process group exists", async () => {
    const child = new ProcessTarget();
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("No process group"), { code: "ESRCH" });
    });
    child.kill.mockImplementation(() => {
      child.exitCode = 0;
      queueMicrotask(() => child.emit("exit"));
      return true;
    });

    await expect(
      terminateWithTreeKill(child, {
        gracefulTimeoutMs: 100,
        forceTimeoutMs: 100,
      }),
    ).resolves.toBe("terminated");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
