import type {
  HarnessCapabilities,
  HarnessToolAttachment,
  RuntimeBundle,
} from "@thoth/drivers/harness";
import type { AgentSessionConfig } from "@thoth/drivers/agent-runtime";
import { withThothRuntimeTools } from "./thoth-runtime-tools-config.js";

export interface ForegroundThothSessionProvisionInput {
  agentId: string;
  config: AgentSessionConfig;
}

export type ForegroundThothSessionProvisioner = (
  input: ForegroundThothSessionProvisionInput,
) => Promise<AgentSessionConfig> | AgentSessionConfig;

function chooseToolAttachment(capabilities: HarnessCapabilities): HarnessToolAttachment | null {
  if (capabilities.toolAttachment.includes("native")) return "native";
  if (capabilities.toolAttachment.includes("acp")) return "acp";
  if (capabilities.toolAttachment.includes("mcp")) return "mcp";
  return null;
}

/** Attaches the immutable Clarify bundle before a visible provider thread starts. */
export function provisionForegroundThothSession(input: {
  config: AgentSessionConfig;
  capabilities: HarnessCapabilities;
  bundle: RuntimeBundle;
}): AgentSessionConfig {
  if (input.config.internal === true) {
    return input.config;
  }
  const toolAttachment = chooseToolAttachment(input.capabilities);
  if (!toolAttachment) {
    return input.config;
  }

  const marker = `[Thoth RuntimeBundle ${input.bundle.id} ${input.bundle.digest}]`;
  const bundleInstructions = [
    marker,
    "The following RuntimeBundle is session-scoped capability. Apply it only when the current daemon-authorized turn activates Thoth; raw turns must remain normal provider conversation.",
    input.bundle.instructions,
  ].join("\n\n");
  const existingSystemPrompt = input.config.systemPrompt?.trim() ?? "";
  const systemPrompt = existingSystemPrompt.includes(marker)
    ? existingSystemPrompt
    : [existingSystemPrompt, bundleInstructions].filter(Boolean).join("\n\n");
  const withTools = withThothRuntimeTools(
    { ...input.config, systemPrompt },
    { enabled: true, scope: "clarify" },
  );
  return {
    ...withTools,
    extra: {
      ...withTools.extra,
      thothRuntimeAttachment: {
        bundleId: input.bundle.id,
        bundleDigest: input.bundle.digest,
        instructionAttachment: "system",
        toolAttachment,
      },
    },
  };
}
