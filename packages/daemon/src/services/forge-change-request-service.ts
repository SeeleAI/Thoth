import type { ProcessEnvRecord } from "@thoth/drivers/internal/server/thoth-env";
import { execCommand } from "@thoth/drivers/internal/utils/spawn";
import { resolveForgeRepository, type ForgeId, type ForgeRepository } from "@thoth/protocol/forge";

import type { GitHubService } from "./github-service.js";
import type { WorkspaceGitService } from "../server/workspace-git-service.js";
import { runGitCommand } from "../utils/run-git-command.js";

const FORGE_COMMAND_TIMEOUT_MS = 30_000;
const GIT_PUSH_TIMEOUT_MS = 120_000;
const NON_INTERACTIVE_GIT_ENV = { GIT_TERMINAL_PROMPT: "0" } as const;

export type ForgeChangeRequestErrorCode =
  | "invalid_repository"
  | "unsupported_forge"
  | "missing_cli"
  | "authentication_failed"
  | "create_failed";

export class ForgeChangeRequestError extends Error {
  constructor(
    readonly code: ForgeChangeRequestErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ForgeChangeRequestError";
  }
}

export interface CreateForgeChangeRequestInput {
  cwd: string;
  title: string;
  body?: string;
  baseRef?: string;
  forgeHint?: ForgeId;
}

export interface ForgeChangeRequestResult {
  url: string;
  number: number;
  repository: ForgeRepository;
}

interface AdapterCreateInput {
  cwd: string;
  repository: ForgeRepository;
  title: string;
  body: string;
  head: string;
  base: string;
}

export interface ForgeChangeRequestAdapter {
  create(input: AdapterCreateInput): Promise<{ url: string; number: number }>;
}

export class ForgeChangeRequestRegistry {
  private readonly adapters = new Map<ForgeId, ForgeChangeRequestAdapter>();

  register(forge: ForgeId, adapter: ForgeChangeRequestAdapter): this {
    if (this.adapters.has(forge)) {
      throw new Error(`Forge change-request adapter already registered: ${forge}`);
    }
    this.adapters.set(forge, adapter);
    return this;
  }

  get(forge: ForgeId): ForgeChangeRequestAdapter | null {
    return this.adapters.get(forge) ?? null;
  }
}

interface ForgeCommandOptions {
  cwd: string;
  envOverlay?: ProcessEnvRecord;
  timeout?: number;
  maxBuffer?: number;
}

type ForgeCommandRunner = (
  command: string,
  args: string[],
  options: ForgeCommandOptions,
) => Promise<{ stdout: string; stderr: string }>;

export interface ForgeChangeRequestServiceOptions {
  workspaceGitService: Pick<WorkspaceGitService, "getSnapshot">;
  github: Pick<GitHubService, "createPullRequest" | "invalidate">;
  registry?: ForgeChangeRequestRegistry;
  runGit?: typeof runGitCommand;
  runCommand?: ForgeCommandRunner;
}

/**
 * Provider-neutral Forge use case. The Session/Workspace layer asks for one
 * change request; adapter selection and CLI vocabulary remain infrastructure
 * details inside this registry.
 */
export class ForgeChangeRequestService {
  private readonly runGit: typeof runGitCommand;
  private readonly registry: ForgeChangeRequestRegistry;

  constructor(private readonly options: ForgeChangeRequestServiceOptions) {
    this.runGit = options.runGit ?? runGitCommand;
    this.registry =
      options.registry ??
      createDefaultForgeChangeRequestRegistry({
        github: options.github,
        runCommand: options.runCommand ?? execCommand,
      });
  }

  async create(input: CreateForgeChangeRequestInput): Promise<ForgeChangeRequestResult> {
    const snapshot = await this.options.workspaceGitService.getSnapshot(input.cwd, {
      force: true,
      reason: "create-change-request",
    });
    if (!snapshot.git.isGit) {
      throw new ForgeChangeRequestError("invalid_repository", `Not a Git repository: ${input.cwd}`);
    }
    const remoteUrl = snapshot.git.remoteUrl;
    const repository = remoteUrl ? resolveForgeRepository(remoteUrl, input.forgeHint) : null;
    if (!repository) {
      throw new ForgeChangeRequestError(
        remoteUrl ? "unsupported_forge" : "invalid_repository",
        remoteUrl
          ? `Unable to resolve a supported Forge for remote ${remoteUrl}`
          : "The Workspace has no origin remote",
      );
    }
    const adapter = this.registry.get(repository.forge);
    if (!adapter) {
      throw new ForgeChangeRequestError(
        "unsupported_forge",
        `No change-request adapter is registered for ${repository.forge}`,
      );
    }
    const head = normalizeBranch(snapshot.git.currentBranch);
    const base = normalizeBranch(input.baseRef ?? snapshot.git.baseRef);
    if (!head) {
      throw new ForgeChangeRequestError(
        "invalid_repository",
        "Unable to determine the change-request head branch",
      );
    }
    if (!base) {
      throw new ForgeChangeRequestError(
        "invalid_repository",
        "Unable to determine the change-request base branch",
      );
    }
    if (head === base) {
      throw new ForgeChangeRequestError(
        "invalid_repository",
        `Head branch ${head} is the same as base branch ${base}`,
      );
    }

    await this.runGit(["push", "-u", "origin", head], {
      cwd: input.cwd,
      timeout: GIT_PUSH_TIMEOUT_MS,
      envOverlay: NON_INTERACTIVE_GIT_ENV,
    });
    const created = await adapter.create({
      cwd: input.cwd,
      repository,
      title: input.title,
      body: input.body ?? "",
      head,
      base,
    });
    return { ...created, repository };
  }
}

function createDefaultForgeChangeRequestRegistry(input: {
  github: Pick<GitHubService, "createPullRequest" | "invalidate">;
  runCommand: ForgeCommandRunner;
}): ForgeChangeRequestRegistry {
  const registry = new ForgeChangeRequestRegistry();
  registry.register("github", {
    async create(options) {
      const result = await input.github.createPullRequest({
        cwd: options.cwd,
        repo: options.repository.fullName,
        title: options.title,
        body: options.body,
        head: options.head,
        base: options.base,
      });
      input.github.invalidate({ cwd: options.cwd });
      return result;
    },
  });
  registry.register(
    "gitlab",
    createCliAdapter({
      brand: "GitLab",
      command: "glab",
      envOverlay: { ...NON_INTERACTIVE_GIT_ENV, GLAB_CHECK_UPDATE: "0" },
      buildArgs: (options) => [
        "mr",
        "create",
        "--title",
        options.title,
        "--description",
        options.body,
        "--source-branch",
        options.head,
        "--target-branch",
        options.base,
        "--yes",
      ],
      parseResult: parseGitLabResult,
      runCommand: input.runCommand,
    }),
  );
  const teaAdapter = createCliAdapter({
    brand: "Gitea-compatible",
    command: "tea",
    envOverlay: NON_INTERACTIVE_GIT_ENV,
    buildArgs: (options) => [
      "pr",
      "create",
      "--title",
      options.title,
      "--description",
      options.body,
      "--head",
      options.head,
      "--base",
      options.base,
    ],
    parseResult: parseGiteaResult,
    runCommand: input.runCommand,
  });
  registry.register("gitea", teaAdapter);
  registry.register("forgejo", teaAdapter);
  registry.register("codeberg", teaAdapter);
  return registry;
}

function createCliAdapter(options: {
  brand: string;
  command: string;
  envOverlay: ProcessEnvRecord;
  buildArgs: (input: AdapterCreateInput) => string[];
  parseResult: (stdout: string) => { url: string; number: number } | null;
  runCommand: ForgeCommandRunner;
}): ForgeChangeRequestAdapter {
  return {
    async create(input) {
      const args = options.buildArgs(input);
      let stdout: string;
      try {
        const result = await options.runCommand(options.command, args, {
          cwd: input.cwd,
          envOverlay: options.envOverlay,
          timeout: FORGE_COMMAND_TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024,
        });
        stdout = result.stdout;
      } catch (error) {
        throw normalizeForgeCliError(error, options.brand, options.command);
      }
      const result = options.parseResult(stdout);
      if (!result) {
        throw new ForgeChangeRequestError(
          "create_failed",
          `${options.brand} reported success but did not return a valid change-request URL`,
        );
      }
      return result;
    },
  };
}

function parseGitLabResult(stdout: string): { url: string; number: number } | null {
  const match = stdout.match(/(https?:\/\/\S+\/-\/merge_requests\/(\d+))/u);
  return match?.[1] && match[2] ? { url: match[1], number: Number(match[2]) } : null;
}

function parseGiteaResult(stdout: string): { url: string; number: number } | null {
  const match = stdout.match(/(https?:\/\/\S+\/pulls\/(\d+))/u);
  return match?.[1] && match[2] ? { url: match[1], number: Number(match[2]) } : null;
}

function normalizeBranch(value: string | null | undefined): string | null {
  const normalized = value
    ?.trim()
    .replace(/^refs\/heads\//u, "")
    .replace(/^origin\//u, "");
  return normalized && normalized.toUpperCase() !== "HEAD" ? normalized : null;
}

function normalizeForgeCliError(
  error: unknown,
  brand: string,
  command: string,
): ForgeChangeRequestError {
  const record = error && typeof error === "object" ? (error as Record<string, unknown>) : null;
  if (record?.code === "ENOENT") {
    return new ForgeChangeRequestError(
      "missing_cli",
      `${brand} CLI (${command}) is not installed or not in PATH`,
      { cause: error },
    );
  }
  const stderr = typeof record?.stderr === "string" ? record.stderr : "";
  const message = error instanceof Error ? error.message : String(error);
  if (
    /(?:401|403|unauthorized|not logged in|authentication failed|invalid token|access denied)/iu.test(
      `${stderr}\n${message}`,
    )
  ) {
    return new ForgeChangeRequestError(
      "authentication_failed",
      `${brand} CLI authentication failed`,
      { cause: error },
    );
  }
  return new ForgeChangeRequestError("create_failed", `${brand} change-request creation failed`, {
    cause: error,
  });
}
