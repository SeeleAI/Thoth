import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, stat, unlink, utimes } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export const pidLockInfoSchema = z.object({
  pid: z.number(),
  startedAt: z.string(),
  hostname: z.string(),
  uid: z.number(),
  listen: z.string().nullable(),
  desktopManaged: z.boolean().optional(),
  heartbeat: z.literal(true).optional(),
  instanceId: z.string().min(1).max(200).optional(),
});

export interface PidLockInfo extends z.infer<typeof pidLockInfoSchema> {}

export interface PidLockOwnership {
  ownerPid: number;
  instanceId: string;
}

interface PidLockOwnerOptions {
  ownerPid?: number;
  instanceId?: string;
}

interface AcquirePidLockOptions extends PidLockOwnerOptions {
  reclaimStaleDesktopLock?: boolean;
}

function parsePidLockInfo(raw: unknown): PidLockInfo | null {
  const result = pidLockInfoSchema.safeParse(raw);
  return result.success ? result.data : null;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export class PidLockError extends Error {
  constructor(
    message: string,
    public readonly existingLock?: PidLockInfo,
  ) {
    super(message);
    this.name = "PidLockError";
  }
}

// Abandoned-lock recovery must tolerate ordinary event-loop and filesystem stalls.
const PID_LOCK_STALE_MS = 5 * 60_000;
const PID_LOCK_HEARTBEAT_INTERVAL_MS = 30_000;
const PID_LOCK_READ_RETRY_ATTEMPTS = 10;
const PID_LOCK_READ_RETRY_DELAY_MS = 50;

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getPidFilePath(thothHome: string): string {
  return join(thothHome, "thoth.pid");
}

function resolveOwnerPid(ownerPid?: number): number {
  if (typeof ownerPid === "number" && Number.isInteger(ownerPid) && ownerPid > 0) {
    return ownerPid;
  }
  return process.pid;
}

function resolveAcquisitionOwner(options?: PidLockOwnerOptions): PidLockOwnership {
  return {
    ownerPid: resolveOwnerPid(options?.ownerPid),
    instanceId: options?.instanceId?.trim() || randomUUID(),
  };
}

function resolveOwner(options?: PidLockOwnerOptions): {
  ownerPid: number;
  instanceId?: string;
} {
  const instanceId = options?.instanceId?.trim();
  return {
    ownerPid: resolveOwnerPid(options?.ownerPid),
    ...(instanceId ? { instanceId } : {}),
  };
}

function isOwnedBy(lock: PidLockInfo, owner: { ownerPid: number; instanceId?: string }): boolean {
  if (lock.pid !== owner.ownerPid) {
    return false;
  }
  if (lock.instanceId !== undefined) {
    return lock.instanceId === owner.instanceId;
  }

  // Legacy locks had no instance identity. Legacy update/release remains compatible only for a
  // caller that also has no instance token; every newly acquired lock is instance-fenced.
  return owner.instanceId === undefined;
}

function isSamePidLock(left: PidLockInfo, right: PidLockInfo): boolean {
  if (left.instanceId !== undefined || right.instanceId !== undefined) {
    return (
      left.pid === right.pid &&
      left.instanceId !== undefined &&
      left.instanceId === right.instanceId
    );
  }
  return (
    left.pid === right.pid &&
    left.startedAt === right.startedAt &&
    left.hostname === right.hostname &&
    left.uid === right.uid
  );
}

async function isPidLockFresh(pidPath: string): Promise<boolean> {
  try {
    const lockStat = await stat(pidPath);
    return lockStat.mtimeMs >= Date.now() - PID_LOCK_STALE_MS;
  } catch {
    return false;
  }
}

async function touchPidLockFile(pidPath: string): Promise<void> {
  const now = new Date();
  await utimes(pidPath, now, now);
}

async function readPidLock(pidPath: string): Promise<PidLockInfo | null> {
  try {
    const content = await readFile(pidPath, "utf-8");
    return parsePidLockInfo(JSON.parse(content));
  } catch {
    return null;
  }
}

function createLockHeldError(lock: PidLockInfo): PidLockError {
  return new PidLockError(
    `Another Thoth daemon is already running (PID ${lock.pid}, started ${lock.startedAt})`,
    lock,
  );
}

function canReclaimLiveLock(
  lock: PidLockInfo,
  options: AcquirePidLockOptions | undefined,
): boolean {
  // Desktop only requests this after its semantic status probe established that the recorded
  // managed daemon is unreachable. Fresh heartbeats still win this race.
  return options?.reclaimStaleDesktopLock === true && lock.desktopManaged === true;
}

async function unlinkExistingPidLock(pidPath: string, expectedLock: PidLockInfo): Promise<void> {
  // Re-read immediately before unlinking. An owner heartbeat or replacement identity observed at
  // this boundary must win; PID equality alone is insufficient because operating systems reuse PIDs.
  const confirmedLock = await readPidLock(pidPath);
  if (!confirmedLock || !isSamePidLock(expectedLock, confirmedLock)) {
    throw new PidLockError(
      "PID lock changed while checking whether it was abandoned",
      confirmedLock ?? undefined,
    );
  }

  try {
    await unlink(pidPath);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function clearExistingPidLock(
  pidPath: string,
  existingLock: PidLockInfo,
  owner: PidLockOwnership,
  options: AcquirePidLockOptions | undefined,
): Promise<"already_owned" | "cleared"> {
  const lockOwnerRunning = isPidRunning(existingLock.pid);
  if (isOwnedBy(existingLock, owner) && lockOwnerRunning) {
    await touchPidLockFile(pidPath);
    return "already_owned";
  }

  if (lockOwnerRunning) {
    if (!canReclaimLiveLock(existingLock, options) || (await isPidLockFresh(pidPath))) {
      throw createLockHeldError(existingLock);
    }

    // Recheck freshness before identity fencing so a late heartbeat always prevents reclaim.
    if (await isPidLockFresh(pidPath)) {
      throw createLockHeldError(existingLock);
    }
  }

  await unlinkExistingPidLock(pidPath, existingLock);
  return "cleared";
}

async function writeNewPidLock(pidPath: string, lockInfo: PidLockInfo): Promise<void> {
  let fileHandle: FileHandle | undefined;
  try {
    fileHandle = await open(pidPath, "wx", 0o600);
    await fileHandle.writeFile(JSON.stringify(lockInfo), "utf-8");
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "EEXIST") {
      throw error;
    }

    const raceLock = await readPidLock(pidPath);
    if (raceLock) {
      throw new PidLockError(
        `Another Thoth daemon is already running (PID ${raceLock.pid})`,
        raceLock,
      );
    }
    throw new PidLockError("Failed to acquire PID lock due to race condition");
  } finally {
    await fileHandle?.close();
  }
}

export async function acquirePidLock(
  thothHome: string,
  listen: string | null,
  options?: AcquirePidLockOptions,
): Promise<PidLockOwnership> {
  const pidPath = getPidFilePath(thothHome);

  if (!existsSync(thothHome)) {
    await mkdir(thothHome, { recursive: true });
  }

  const owner = resolveAcquisitionOwner(options);
  const existingLock = await readPidLock(pidPath);
  if (existingLock) {
    const result = await clearExistingPidLock(pidPath, existingLock, owner, options);
    if (result === "already_owned") {
      return owner;
    }
  }

  const lockInfo: PidLockInfo = {
    pid: owner.ownerPid,
    instanceId: owner.instanceId,
    startedAt: new Date().toISOString(),
    hostname: hostname(),
    uid: process.getuid?.() ?? 0,
    listen,
    heartbeat: true,
    ...(process.env.THOTH_DESKTOP_MANAGED === "1" ? { desktopManaged: true } : {}),
  };

  await writeNewPidLock(pidPath, lockInfo);
  return owner;
}

async function readPidLockFromHandle(fileHandle: FileHandle): Promise<PidLockInfo | null> {
  try {
    const { size } = await fileHandle.stat();
    if (size === 0) {
      return null;
    }
    const content = Buffer.alloc(size);
    const { bytesRead } = await fileHandle.read(content, 0, size, 0);
    return parsePidLockInfo(JSON.parse(content.subarray(0, bytesRead).toString("utf-8")));
  } catch {
    return null;
  }
}

async function readPidLockFromHandleWithRetry(fileHandle: FileHandle): Promise<PidLockInfo | null> {
  for (let attempt = 0; attempt < PID_LOCK_READ_RETRY_ATTEMPTS; attempt += 1) {
    const lock = await readPidLockFromHandle(fileHandle);
    if (lock) {
      return lock;
    }
    if (attempt < PID_LOCK_READ_RETRY_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, PID_LOCK_READ_RETRY_DELAY_MS));
    }
  }
  return null;
}

async function openOwnedPidLock(
  thothHome: string,
  options: PidLockOwnerOptions | undefined,
  operation: "refresh" | "update",
): Promise<{ fileHandle: FileHandle; lock: PidLockInfo }> {
  const pidPath = getPidFilePath(thothHome);
  const owner = resolveOwner(options);
  let fileHandle: FileHandle;
  try {
    fileHandle = await open(pidPath, "r+");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      throw new PidLockError(`Cannot ${operation} PID lock: lock file is missing`);
    }
    throw error;
  }

  try {
    const lock = await readPidLockFromHandleWithRetry(fileHandle);
    if (!lock) {
      throw new PidLockError(`Cannot ${operation} PID lock: invalid lock file`);
    }
    if (!isOwnedBy(lock, owner)) {
      throw new PidLockError(
        `Cannot ${operation} PID lock owned by PID ${lock.pid} instance ${lock.instanceId ?? "legacy"}`,
        lock,
      );
    }
    return { fileHandle, lock };
  } catch (error) {
    await fileHandle.close();
    throw error;
  }
}

export async function refreshPidLock(
  thothHome: string,
  options?: PidLockOwnerOptions,
): Promise<void> {
  const { fileHandle } = await openOwnedPidLock(thothHome, options, "refresh");
  try {
    const now = new Date();
    await fileHandle.utimes(now, now);
  } finally {
    await fileHandle.close();
  }
}

export function startPidLockHeartbeat(
  thothHome: string,
  options?: PidLockOwnerOptions & {
    intervalMs?: number;
    onError?: (error: unknown) => void;
  },
): () => Promise<void> {
  const intervalMs = options?.intervalMs ?? PID_LOCK_HEARTBEAT_INTERVAL_MS;
  let stopped = false;
  let inFlight: Promise<void> | null = null;

  const refresh = (): void => {
    if (stopped || inFlight) {
      return;
    }

    const pending = refreshPidLock(thothHome, options)
      .catch((error) => {
        if (options?.onError) {
          try {
            options.onError(error);
          } catch (callbackError) {
            const callbackMessage =
              callbackError instanceof Error ? callbackError.message : String(callbackError);
            process.stderr.write(`PID lock heartbeat error callback failed: ${callbackMessage}\n`);
          }
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`PID lock heartbeat failed: ${message}\n`);
      })
      .finally(() => {
        if (inFlight === pending) {
          inFlight = null;
        }
      });
    inFlight = pending;
  };

  const timer = setInterval(refresh, Math.max(1, intervalMs));
  timer.unref();

  return async () => {
    stopped = true;
    clearInterval(timer);
    await inFlight;
  };
}

export async function updatePidLock(
  thothHome: string,
  patch: { listen: string },
  options?: PidLockOwnerOptions,
): Promise<void> {
  const { fileHandle, lock } = await openOwnedPidLock(thothHome, options, "update");
  try {
    const updatedLock: PidLockInfo = {
      ...lock,
      ...patch,
    };
    await fileHandle.truncate(0);
    await fileHandle.writeFile(JSON.stringify(updatedLock), "utf-8");
  } finally {
    await fileHandle.close();
  }
}

export async function releasePidLock(
  thothHome: string,
  options?: PidLockOwnerOptions,
): Promise<void> {
  const pidPath = getPidFilePath(thothHome);
  const owner = resolveOwner(options);
  const lock = await readPidLock(pidPath);
  if (!lock || !isOwnedBy(lock, owner)) {
    return;
  }

  // Fence replacement between the first read and cleanup. A different instance always wins.
  const confirmedLock = await readPidLock(pidPath);
  if (!confirmedLock || !isSamePidLock(lock, confirmedLock) || !isOwnedBy(confirmedLock, owner)) {
    return;
  }

  try {
    await unlink(pidPath);
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "ENOENT") {
      throw error;
    }
  }
}

export async function getPidLockInfo(thothHome: string): Promise<PidLockInfo | null> {
  return readPidLock(getPidFilePath(thothHome));
}

export async function isLocked(
  thothHome: string,
): Promise<{ locked: boolean; info?: PidLockInfo }> {
  const info = await getPidLockInfo(thothHome);
  if (!info) {
    return { locked: false };
  }
  if (!isPidRunning(info.pid)) {
    return { locked: false, info };
  }
  return { locked: true, info };
}
