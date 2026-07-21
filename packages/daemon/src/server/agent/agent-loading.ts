import type { Logger } from "pino";

import type { AgentProvider } from "@thoth/drivers/agent-runtime";
import type { AgentManager, ManagedAgent } from "./agent-manager.js";
import type { AgentRegistry } from "./agent-storage.js";
import {
  buildConfigOverrides,
  buildSessionConfig,
  extractTimestamps,
  isStoredAgentProviderAvailable,
  toAgentPersistenceHandle,
} from "../persistence-hooks.js";

const pendingAgentInitializations = new Map<string, Promise<ManagedAgent>>();

export interface EnsureAgentLoadedDeps {
  agentManager: AgentManager;
  agentStorage: AgentRegistry;
  validProviders?: Iterable<AgentProvider>;
  logger: Logger;
}

export async function ensureAgentLoaded(
  agentId: string,
  deps: EnsureAgentLoadedDeps,
): Promise<ManagedAgent> {
  const existing = deps.agentManager.getAgent(agentId);
  if (existing) {
    return existing;
  }

  const inflight = pendingAgentInitializations.get(agentId);
  if (inflight) {
    return inflight;
  }

  const initPromise = (async () => {
    const record = await deps.agentStorage.get(agentId);
    if (!record) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const validProviders = deps.validProviders ?? deps.agentManager.getRegisteredProviderIds();
    const providerAvailable = isStoredAgentProviderAvailable(record, validProviders);
    const handle = providerAvailable
      ? toAgentPersistenceHandle(validProviders, record.persistence)
      : null;

    try {
      let snapshot: ManagedAgent;
      if (handle) {
        snapshot = await deps.agentManager.resumeAgentFromPersistence(
          handle,
          buildConfigOverrides(record),
          agentId,
          {
            ...extractTimestamps(record),
            historyOnly: Boolean(record.archivedAt),
          },
        );
        deps.logger.info(
          {
            agentId,
            provider: record.provider,
            historyOnly: Boolean(record.archivedAt),
          },
          record.archivedAt
            ? "Archived agent history loaded from persistence"
            : "Agent resumed from persistence",
        );
      } else {
        const config = buildSessionConfig(record, {
          validProviders,
        });
        if (!config) {
          throw new Error(`Agent ${agentId} references unavailable provider '${record.provider}'`);
        }
        snapshot = await deps.agentManager.createAgent(config, agentId, {
          labels: record.labels,
          workspaceId: record.workspaceId,
        });
        deps.logger.info(
          { agentId, provider: record.provider },
          "Agent created from stored config",
        );
      }

      await deps.agentManager.hydrateTimelineFromProvider(agentId);
      return deps.agentManager.getAgent(agentId) ?? snapshot;
    } catch (error) {
      const history = await deps.agentManager.restoreHistoryOnlyAgent(record);
      if (history) {
        deps.logger.warn(
          {
            agentId,
            provider: record.provider,
            providerResumeError: error instanceof Error ? error.message : String(error),
          },
          "Provider session could not resume; serving durable local agent history",
        );
        return history;
      }
      throw error;
    }
  })();

  pendingAgentInitializations.set(agentId, initPromise);

  try {
    return await initPromise;
  } finally {
    const current = pendingAgentInitializations.get(agentId);
    if (current === initPromise) {
      pendingAgentInitializations.delete(agentId);
    }
  }
}
