import { mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import {
  acquirePidLock,
  getPidLockInfo,
  isLocked,
  PidLockError,
  refreshPidLock,
  releasePidLock,
  startPidLockHeartbeat,
  updatePidLock,
} from "./pid-lock.js";

const INSTANCE_A = "11111111-1111-4111-8111-111111111111";
const INSTANCE_B = "22222222-2222-4222-8222-222222222222";

async function writeLock(
  thothHome: string,
  lock: {
    pid: number;
    startedAt?: string;
    instanceId?: string;
    desktopManaged?: boolean;
    heartbeat?: true;
  },
): Promise<string> {
  const pidPath = join(thothHome, "thoth.pid");
  await writeFile(
    pidPath,
    JSON.stringify({
      pid: lock.pid,
      startedAt: lock.startedAt ?? "2026-01-01T00:00:00.000Z",
      hostname: "test-host",
      uid: process.getuid?.() ?? 0,
      listen: "127.0.0.1:6688",
      ...(lock.instanceId ? { instanceId: lock.instanceId } : {}),
      ...(lock.desktopManaged ? { desktopManaged: true } : {}),
      ...(lock.heartbeat ? { heartbeat: true } : {}),
    }),
  );
  return pidPath;
}

async function markStale(pidPath: string): Promise<void> {
  const staleTime = new Date(Date.now() - 10 * 60_000);
  await utimes(pidPath, staleTime, staleTime);
}

describe("pid-lock ownership", () => {
  test("writes, updates and releases only with the exact owner instance", async () => {
    const thothHome = await mkdtemp(join(tmpdir(), "thoth-pid-lock-owner-"));
    const ownerPid = process.pid + 10_000;
    const owner = { ownerPid, instanceId: INSTANCE_A };

    try {
      const acquired = await acquirePidLock(thothHome, null, owner);

      expect(acquired).toEqual(owner);
      const lock = await getPidLockInfo(thothHome);
      expect(lock).toMatchObject({
        pid: ownerPid,
        instanceId: INSTANCE_A,
        listen: null,
        heartbeat: true,
      });

      await updatePidLock(thothHome, { listen: "127.0.0.1:6688" }, owner);
      await expect(
        updatePidLock(
          thothHome,
          { listen: "127.0.0.1:6689" },
          {
            ownerPid,
            instanceId: INSTANCE_B,
          },
        ),
      ).rejects.toBeInstanceOf(PidLockError);

      const updatedLock = await getPidLockInfo(thothHome);
      expect(updatedLock?.listen).toBe("127.0.0.1:6688");

      await releasePidLock(thothHome, { ownerPid, instanceId: INSTANCE_B });
      expect(await getPidLockInfo(thothHome)).toMatchObject({ instanceId: INSTANCE_A });

      await releasePidLock(thothHome, owner);
      expect(await getPidLockInfo(thothHome)).toBeNull();
    } finally {
      await rm(thothHome, { recursive: true, force: true });
    }
  });

  test("does not treat a reused owner pid as the same daemon instance", async () => {
    const thothHome = await mkdtemp(join(tmpdir(), "thoth-pid-lock-pid-reuse-"));
    const ownerPid = process.pid;

    try {
      await acquirePidLock(thothHome, null, { ownerPid, instanceId: INSTANCE_A });

      await expect(
        acquirePidLock(thothHome, null, { ownerPid, instanceId: INSTANCE_B }),
      ).rejects.toMatchObject({
        name: "PidLockError",
        existingLock: expect.objectContaining({ instanceId: INSTANCE_A }),
      });
      expect(await getPidLockInfo(thothHome)).toMatchObject({ instanceId: INSTANCE_A });
    } finally {
      await rm(thothHome, { recursive: true, force: true });
    }
  });

  test("keeps a stale live lock unless Desktop explicitly confirmed the daemon is unreachable", async () => {
    const thothHome = await mkdtemp(join(tmpdir(), "thoth-pid-lock-stale-live-"));

    try {
      const pidPath = await writeLock(thothHome, {
        pid: process.pid,
        instanceId: INSTANCE_A,
        desktopManaged: true,
        heartbeat: true,
      });
      await markStale(pidPath);

      await expect(isLocked(thothHome)).resolves.toMatchObject({ locked: true });
      await expect(
        acquirePidLock(thothHome, null, {
          ownerPid: process.pid + 10_000,
          instanceId: INSTANCE_B,
        }),
      ).rejects.toBeInstanceOf(PidLockError);
      expect(await getPidLockInfo(thothHome)).toMatchObject({ instanceId: INSTANCE_A });
    } finally {
      await rm(thothHome, { recursive: true, force: true });
    }
  });

  test("reclaims only a stale Desktop-managed lock after an explicit unreachable receipt", async () => {
    const thothHome = await mkdtemp(join(tmpdir(), "thoth-pid-lock-stale-desktop-"));

    try {
      const pidPath = await writeLock(thothHome, {
        pid: process.pid,
        instanceId: INSTANCE_A,
        desktopManaged: true,
        heartbeat: true,
      });
      await markStale(pidPath);

      await acquirePidLock(thothHome, null, {
        ownerPid: process.pid + 10_000,
        instanceId: INSTANCE_B,
        reclaimStaleDesktopLock: true,
      });

      expect(await getPidLockInfo(thothHome)).toMatchObject({
        pid: process.pid + 10_000,
        instanceId: INSTANCE_B,
        listen: null,
      });
    } finally {
      await rm(thothHome, { recursive: true, force: true });
    }
  });

  test("does not reclaim a fresh Desktop-managed lock even with an unreachable receipt", async () => {
    const thothHome = await mkdtemp(join(tmpdir(), "thoth-pid-lock-fresh-desktop-"));

    try {
      await writeLock(thothHome, {
        pid: process.pid,
        instanceId: INSTANCE_A,
        desktopManaged: true,
        heartbeat: true,
      });

      await expect(
        acquirePidLock(thothHome, null, {
          ownerPid: process.pid + 10_000,
          instanceId: INSTANCE_B,
          reclaimStaleDesktopLock: true,
        }),
      ).rejects.toBeInstanceOf(PidLockError);
      expect(await getPidLockInfo(thothHome)).toMatchObject({ instanceId: INSTANCE_A });
    } finally {
      await rm(thothHome, { recursive: true, force: true });
    }
  });

  test("preserves compatibility with a stale legacy Desktop lock only through explicit reclaim", async () => {
    const thothHome = await mkdtemp(join(tmpdir(), "thoth-pid-lock-legacy-desktop-"));

    try {
      const pidPath = await writeLock(thothHome, {
        pid: process.pid,
        desktopManaged: true,
      });
      await markStale(pidPath);

      await acquirePidLock(thothHome, null, {
        ownerPid: process.pid + 10_000,
        instanceId: INSTANCE_B,
        reclaimStaleDesktopLock: true,
      });

      expect(await getPidLockInfo(thothHome)).toMatchObject({
        instanceId: INSTANCE_B,
        heartbeat: true,
      });
    } finally {
      await rm(thothHome, { recursive: true, force: true });
    }
  });

  test("rejects refresh when either pid or instance identity is wrong", async () => {
    const thothHome = await mkdtemp(join(tmpdir(), "thoth-pid-lock-refresh-owner-"));

    try {
      const owner = { ownerPid: process.pid, instanceId: INSTANCE_A };
      await acquirePidLock(thothHome, null, owner);

      await expect(
        refreshPidLock(thothHome, { ownerPid: process.pid, instanceId: INSTANCE_B }),
      ).rejects.toBeInstanceOf(PidLockError);
      await expect(
        refreshPidLock(thothHome, { ownerPid: process.pid + 1, instanceId: INSTANCE_A }),
      ).rejects.toBeInstanceOf(PidLockError);
      await expect(refreshPidLock(thothHome, owner)).resolves.toBeUndefined();
    } finally {
      await rm(thothHome, { recursive: true, force: true });
    }
  });

  test("heartbeat refreshes the lock and a completed stop prevents later touches", async () => {
    const thothHome = await mkdtemp(join(tmpdir(), "thoth-pid-lock-heartbeat-stop-"));
    const owner = { ownerPid: process.pid, instanceId: INSTANCE_A };

    try {
      await acquirePidLock(thothHome, null, owner);
      const pidPath = join(thothHome, "thoth.pid");
      const oldTime = new Date("2020-01-01T00:00:00.000Z");
      await utimes(pidPath, oldTime, oldTime);

      const stopHeartbeat = startPidLockHeartbeat(thothHome, {
        ...owner,
        intervalMs: 5,
      });

      let refreshedMtime = (await stat(pidPath)).mtimeMs;
      for (let attempt = 0; attempt < 40 && refreshedMtime === oldTime.getTime(); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        refreshedMtime = (await stat(pidPath)).mtimeMs;
      }
      expect(refreshedMtime).toBeGreaterThan(oldTime.getTime());

      await stopHeartbeat();
      const stoppedMtime = (await stat(pidPath)).mtimeMs;
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect((await stat(pidPath)).mtimeMs).toBe(stoppedMtime);
    } finally {
      await rm(thothHome, { recursive: true, force: true });
    }
  });
});
