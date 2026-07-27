// Shell environment resolution adapted from VS Code
// https://github.com/microsoft/vscode/blob/main/src/vs/platform/shell/node/shellEnv.ts
// Licensed under the MIT License.

import type { SpawnSyncReturns } from "node:child_process";
import { spawnSync as defaultSpawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { userInfo as defaultUserInfo } from "node:os";
import { basename } from "node:path";
import defaultLog from "electron-log/main";

const DEFAULT_RESOLVE_TIMEOUT_MS = 30_000;
const TIMEOUT_ENV_KEY = "THOTH_SHELL_ENV_TIMEOUT_MS";
const STDERR_LOG_LIMIT = 2000;

type LoginShellEnvLogger = Pick<typeof defaultLog, "info" | "warn">;
type ShellEnvAttemptKind = "interactive" | "non-interactive";

interface LoginShellEnvDependencies {
  env?: NodeJS.ProcessEnv;
  logger?: LoginShellEnvLogger;
  now?: () => number;
  platform?: NodeJS.Platform;
  spawnSync?: typeof defaultSpawnSync;
  userInfo?: typeof defaultUserInfo;
}

function truncateForLog(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > STDERR_LOG_LIMIT
    ? `${trimmed.slice(0, STDERR_LOG_LIMIT)}...(truncated)`
    : trimmed;
}

function pathEnv(env: NodeJS.ProcessEnv | Record<string, string>): string | null {
  return env.PATH ?? env.Path ?? null;
}

interface ShellEnvErrorDetails {
  reason: string;
  attemptKind?: ShellEnvAttemptKind;
  argv0?: string;
  shell?: string;
  shellArgs?: string[];
  status?: number | null;
  signal?: NodeJS.Signals | null;
  stdoutLength?: number;
  markerFound?: boolean;
  stderr?: string;
}

interface ShellEnvAttempt {
  kind: ShellEnvAttemptKind;
  argv0?: string;
  shellArgs: string[];
}

interface ShellEnvCommand {
  command: string;
  attempts: ShellEnvAttempt[];
}

interface ResolvedShellEnv {
  env: Record<string, string>;
  attemptKind: ShellEnvAttemptKind;
  timeoutMs: number;
}

class ShellEnvError extends Error {
  constructor(
    message: string,
    readonly details: ShellEnvErrorDetails,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ShellEnvError";
  }
}

function throwIfShellFailed(
  result: SpawnSyncReturns<string>,
  regex: RegExp,
  shell: string,
  attempt: ShellEnvAttempt,
): void {
  if (result.error || result.signal) {
    const errorCode = (result.error as NodeJS.ErrnoException | undefined)?.code;
    throw new ShellEnvError(
      "login shell did not complete",
      {
        reason: errorCode === "ETIMEDOUT" ? "timeout" : result.error ? "spawn-error" : "signal",
        attemptKind: attempt.kind,
        argv0: attempt.argv0,
        shell,
        shellArgs: attempt.shellArgs,
        status: result.status,
        signal: result.signal,
        stdoutLength: result.stdout?.length ?? 0,
        markerFound: regex.test(result.stdout ?? ""),
        stderr: result.stderr,
      },
      { cause: result.error },
    );
  }
  if (result.status !== 0 && result.status !== null) {
    throw new ShellEnvError("login shell exited non-zero", {
      reason: "non-zero-exit",
      attemptKind: attempt.kind,
      argv0: attempt.argv0,
      shell,
      shellArgs: attempt.shellArgs,
      status: result.status,
      signal: result.signal,
      stdoutLength: result.stdout?.length ?? 0,
      markerFound: regex.test(result.stdout ?? ""),
      stderr: result.stderr,
    });
  }
  if (!result.stdout) {
    throw new ShellEnvError(
      "login shell produced no stdout",
      {
        reason: "no-stdout",
        attemptKind: attempt.kind,
        argv0: attempt.argv0,
        shell,
        shellArgs: attempt.shellArgs,
        status: result.status,
        signal: result.signal,
        stdoutLength: result.stdout?.length ?? 0,
        markerFound: false,
        stderr: result.stderr,
      },
      { cause: result.error },
    );
  }
}

function getSystemShell(
  deps: Required<Pick<LoginShellEnvDependencies, "env" | "platform" | "userInfo">>,
): string {
  const shell = deps.env.SHELL;
  if (shell) return shell;

  try {
    const info = deps.userInfo();
    if (info.shell && info.shell !== "/bin/false") return info.shell;
  } catch {}

  return deps.platform === "darwin" ? "/bin/zsh" : "/bin/bash";
}

function timeoutMsFromEnv(env: NodeJS.ProcessEnv): number {
  const configured = Number.parseInt(env[TIMEOUT_ENV_KEY] ?? "", 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_RESOLVE_TIMEOUT_MS;
}

function shellEnvCommand(shell: string, mark: string): ShellEnvCommand {
  const name = basename(shell);
  if (/^(?:pwsh|powershell)(?:-preview)?$/.test(name)) {
    return {
      command: `& '${process.execPath}' -p '''${mark}'' + JSON.stringify(process.env) + ''${mark}'''`,
      attempts: [{ kind: "non-interactive", shellArgs: ["-Login", "-Command"] }],
    };
  }
  if (name === "nu") {
    return {
      command: `^'${process.execPath}' -p '"${mark}" + JSON.stringify(process.env) + "${mark}"'`,
      attempts: [
        { kind: "interactive", shellArgs: ["-i", "-l", "-c"] },
        { kind: "non-interactive", shellArgs: ["-l", "-c"] },
      ],
    };
  }
  if (name === "xonsh") {
    return {
      command: `import os, json; print("${mark}", json.dumps(dict(os.environ)), "${mark}")`,
      attempts: [
        { kind: "interactive", shellArgs: ["-i", "-l", "-c"] },
        { kind: "non-interactive", shellArgs: ["-l", "-c"] },
      ],
    };
  }
  const command = `'${process.execPath}' -p '"${mark}" + JSON.stringify(process.env) + "${mark}"'`;
  if (name === "tcsh" || name === "csh") {
    return {
      command,
      attempts: [
        { kind: "interactive", shellArgs: ["-ic"] },
        { kind: "non-interactive", argv0: `-${name}`, shellArgs: ["-c"] },
      ],
    };
  }
  return {
    command,
    attempts: [
      { kind: "interactive", shellArgs: ["-i", "-l", "-c"] },
      { kind: "non-interactive", shellArgs: ["-l", "-c"] },
    ],
  };
}

function restoreElectronEnvironment(
  env: Record<string, string>,
  savedRunAsNode: string | undefined,
  savedNoAttach: string | undefined,
): void {
  if (savedRunAsNode) env.ELECTRON_RUN_AS_NODE = savedRunAsNode;
  else delete env.ELECTRON_RUN_AS_NODE;
  if (savedNoAttach) env.ELECTRON_NO_ATTACH_CONSOLE = savedNoAttach;
  else delete env.ELECTRON_NO_ATTACH_CONSOLE;
  delete env.XDG_RUNTIME_DIR;
}

function resolveShellEnv(deps: Required<LoginShellEnvDependencies>): ResolvedShellEnv {
  if (deps.platform === "win32") {
    throw new ShellEnvError("login shell env is not resolved on Windows", { reason: "win32" });
  }

  const savedRunAsNode = deps.env.ELECTRON_RUN_AS_NODE;
  const savedNoAttach = deps.env.ELECTRON_NO_ATTACH_CONSOLE;

  const mark = randomUUID().replace(/-/g, "").slice(0, 12);
  const regex = new RegExp(mark + "({.*})" + mark);

  const shell = getSystemShell(deps);
  const { command, attempts } = shellEnvCommand(shell, mark);
  const timeoutMs = timeoutMsFromEnv(deps.env);

  const shellEnv = { ...deps.env };
  delete shellEnv.THOTH_NODE_ENV;
  delete shellEnv.THOTH_DESKTOP_MANAGED;
  delete shellEnv.THOTH_SUPERVISED;

  deps.logger.info("[login-shell-env] start", {
    shell,
    shellArgs: attempts[0]?.shellArgs ?? [],
    attempts,
    timeoutMs,
    beforePath: pathEnv(deps.env),
  });

  const startedAt = deps.now();
  let lastError: unknown;
  for (const [index, attempt] of attempts.entries()) {
    const elapsedMs = deps.now() - startedAt;
    const attemptTimeoutMs =
      attempts.length === 1
        ? timeoutMs
        : index === 0
          ? Math.max(1, Math.floor(timeoutMs / 2))
          : timeoutMs - elapsedMs;
    if (attemptTimeoutMs <= 0) break;

    const result = deps.spawnSync(shell, [...attempt.shellArgs, command], {
      ...(attempt.argv0 ? { argv0: attempt.argv0 } : {}),
      encoding: "utf8",
      timeout: attemptTimeoutMs,
      windowsHide: true,
      env: {
        ...shellEnv,
        ELECTRON_RUN_AS_NODE: "1",
        ELECTRON_NO_ATTACH_CONSOLE: "1",
      },
    });

    try {
      throwIfShellFailed(result, regex, shell, attempt);
      const match = regex.exec(result.stdout);
      if (!match?.[1]) {
        throw new ShellEnvError("login shell output did not contain environment marker", {
          reason: "marker-missing",
          attemptKind: attempt.kind,
          argv0: attempt.argv0,
          shell,
          shellArgs: attempt.shellArgs,
          status: result.status,
          signal: result.signal,
          stdoutLength: result.stdout.length,
          markerFound: false,
          stderr: result.stderr,
        });
      }

      let env: Record<string, string>;
      try {
        env = JSON.parse(match[1]) as Record<string, string>;
      } catch (error) {
        throw new ShellEnvError(
          "failed to parse login shell environment JSON",
          {
            reason: "json-parse",
            attemptKind: attempt.kind,
            argv0: attempt.argv0,
            shell,
            shellArgs: attempt.shellArgs,
            status: result.status,
            signal: result.signal,
            stdoutLength: result.stdout.length,
            markerFound: true,
            stderr: result.stderr,
          },
          { cause: error },
        );
      }
      restoreElectronEnvironment(env, savedRunAsNode, savedNoAttach);
      return { env, attemptKind: attempt.kind, timeoutMs };
    } catch (error) {
      lastError = error;
      const hasRetry = index < attempts.length - 1 && timeoutMs - (deps.now() - startedAt) > 0;
      if (hasRetry) {
        const details =
          error instanceof ShellEnvError
            ? error.details
            : {
                reason: "throw",
                attemptKind: attempt.kind,
                shell,
                shellArgs: attempt.shellArgs,
              };
        deps.logger.warn("[login-shell-env] interactive attempt failed; retrying", {
          ...details,
          timeoutMs: attemptTimeoutMs,
          error: error instanceof Error ? error.message : String(error),
          stderr: truncateForLog(details.stderr),
        });
      }
    }
  }

  throw (
    lastError ??
    new ShellEnvError("login shell environment timeout budget exhausted", {
      reason: "timeout",
      shell,
    })
  );
}

/**
 * On macOS/Linux, Electron inherits a minimal environment when launched from
 * Finder/Dock. Spawn the user's login shell and capture its full environment
 * via Node's JSON.stringify(process.env), so the daemon and all child processes
 * see the same tools and variables as a normal terminal session.
 *
 * Approach borrowed from VS Code (src/vs/platform/shell/node/shellEnv.ts).
 */
export function inheritLoginShellEnv(input: LoginShellEnvDependencies = {}): void {
  const deps: Required<LoginShellEnvDependencies> = {
    env: input.env ?? process.env,
    logger: input.logger ?? defaultLog,
    now: input.now ?? Date.now,
    platform: input.platform ?? process.platform,
    spawnSync: input.spawnSync ?? defaultSpawnSync,
    userInfo: input.userInfo ?? defaultUserInfo,
  };
  const beforePath = pathEnv(deps.env);
  const startedAt = deps.now();
  const timeoutMs = timeoutMsFromEnv(deps.env);

  try {
    const { env, attemptKind } = resolveShellEnv(deps);
    Object.assign(deps.env, env);
    deps.logger.info("[login-shell-env] applied", {
      attemptKind,
      durationMs: deps.now() - startedAt,
      timeoutMs,
      beforePath,
      afterPath: pathEnv(deps.env),
      pathChanged: beforePath !== pathEnv(deps.env),
      shell: deps.env.SHELL ?? null,
    });
  } catch (error) {
    const details: ShellEnvErrorDetails =
      error instanceof ShellEnvError
        ? error.details
        : { reason: "throw", shell: deps.env.SHELL ?? undefined };
    const cause = error instanceof Error ? error.cause : undefined;
    deps.logger.warn("[login-shell-env] failed; keeping inherited env", {
      ...details,
      durationMs: deps.now() - startedAt,
      timeoutMs,
      error: error instanceof Error ? error.message : String(error),
      errorCode: (cause as NodeJS.ErrnoException | undefined)?.code ?? null,
      stderr: truncateForLog(details.stderr),
      beforePath,
      afterPath: pathEnv(deps.env),
      pathChanged: beforePath !== pathEnv(deps.env),
    });
    // Keep inherited environment if shell lookup fails.
  }
}
