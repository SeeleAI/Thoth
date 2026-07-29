import type { HarnessCapabilities, HarnessToolAttachment } from "./types.js";
import type { ProviderPlanCapability } from "@thoth/protocol/provider-control";

export interface HarnessCapabilityInput {
  toolAttachment: readonly HarnessToolAttachment[];
  instructionAttachment?: HarnessCapabilities["instructionAttachment"];
  continuation?: HarnessCapabilities["continuation"];
  interrupt?: HarnessCapabilities["interrupt"];
  eventReplay?: HarnessCapabilities["eventReplay"];
  permissions?: HarnessCapabilities["permissions"];
  threadPersistence?: HarnessCapabilities["threadPersistence"];
  nativeRetention?: HarnessCapabilities["nativeRetention"];
  runtimeBundleActivation?: HarnessCapabilities["runtimeBundleActivation"];
  plan?: ProviderPlanCapability;
}

/** Defines one immutable provider capability receipt without provider-name branching. */
export function defineHarnessCapabilities(input: HarnessCapabilityInput): HarnessCapabilities {
  return Object.freeze({
    instructionAttachment: input.instructionAttachment ?? (["system"] as const),
    toolAttachment: Object.freeze([...input.toolAttachment]),
    continuation: input.continuation ?? "same_thread",
    interrupt: input.interrupt ?? "cooperative",
    eventReplay: input.eventReplay ?? "live_only",
    permissions: input.permissions ?? "interactive",
    threadPersistence: input.threadPersistence ?? "native",
    nativeRetention: input.nativeRetention ?? "provider_owned",
    runtimeBundleActivation: input.runtimeBundleActivation ?? "unsupported",
    plan:
      input.plan ??
      ({ kind: "unsupported", reason: "Provider adapter does not expose native Plan." } as const),
  });
}

export const NO_HARNESS_CAPABILITIES = defineHarnessCapabilities({
  instructionAttachment: [],
  toolAttachment: [],
  continuation: "replacement_thread",
  eventReplay: "live_only",
  threadPersistence: "none",
  nativeRetention: "adapter_owned",
  runtimeBundleActivation: "unsupported",
  plan: { kind: "unsupported", reason: "Provider adapter does not expose native Plan." },
});
