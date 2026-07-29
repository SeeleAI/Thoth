import type { HarnessCapabilities, RuntimeBundle } from "@thoth/drivers/harness";
import type { AgentMetadata, AgentSessionConfig } from "@thoth/drivers/agent-runtime";

export interface ForegroundThothSessionProvisionInput {
  agentId: string;
  config: AgentSessionConfig;
}

export type ForegroundThothSessionProvisioner = (
  input: ForegroundThothSessionProvisionInput,
) => Promise<AgentSessionConfig> | AgentSessionConfig;

const LEGACY_RUNTIME_EXPLANATION =
  "The following RuntimeBundle is session-scoped capability. Apply it only when the current daemon-authorized turn activates Thoth; raw turns must remain normal provider conversation.";

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function withoutLegacyRuntimeMetadata(
  extra: AgentMetadata | null | undefined,
  blocker: boolean,
): AgentMetadata | undefined {
  const next = { ...(extra ?? {}) };
  delete next.thothRuntimeAttachment;
  delete next.thothRuntimeTools;
  delete next.thothRuntimeMigrationBlocker;
  if (blocker) {
    next.thothRuntimeMigrationBlocker = {
      code: "THOTH_RUNTIME_PROMPT_PROVENANCE_UNVERIFIED",
      message:
        "A legacy Thoth RuntimeBundle marker remains in the user system prompt because its generated boundary could not be proven exactly.",
    };
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * Removes the former session-scoped Clarify attachment without changing the
 * native Provider session identity. New RuntimeBundles are activated per turn;
 * this provisioner exists only as an idempotent migration for stored Agents.
 */
export function provisionForegroundThothSession(input: {
  config: AgentSessionConfig;
  capabilities: HarnessCapabilities;
  bundle: RuntimeBundle;
}): AgentSessionConfig {
  const config = input.config;
  const extra = readRecord(config.extra);
  const attachment = readRecord(extra?.thothRuntimeAttachment);
  const marker = `[Thoth RuntimeBundle ${input.bundle.id} ${input.bundle.digest}]`;
  const generatedSuffix = [marker, LEGACY_RUNTIME_EXPLANATION, input.bundle.instructions].join(
    "\n\n",
  );
  const currentPrompt = config.systemPrompt ?? "";
  const attachmentMatches =
    attachment?.bundleId === input.bundle.id && attachment.bundleDigest === input.bundle.digest;

  let nextPrompt = currentPrompt;
  let blocker = false;
  if (attachmentMatches && currentPrompt === generatedSuffix) {
    nextPrompt = "";
  } else if (attachmentMatches && currentPrompt.endsWith(`\n\n${generatedSuffix}`)) {
    nextPrompt = currentPrompt.slice(0, -(generatedSuffix.length + 2));
  } else if (currentPrompt.includes(marker)) {
    blocker = true;
  }

  const nextExtra = withoutLegacyRuntimeMetadata(config.extra, blocker);
  const next: AgentSessionConfig = { ...config };
  if (nextPrompt) {
    next.systemPrompt = nextPrompt;
  } else {
    delete next.systemPrompt;
  }
  if (nextExtra) {
    next.extra = nextExtra;
  } else {
    delete next.extra;
  }
  return next;
}
