import { useEffect, useSyncExternalStore } from "react";

export interface CommandCenterModelChoice {
  id: string;
  providerId: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  selected: boolean;
  keywords: readonly string[];
  run: () => void;
}

export interface CommandCenterModelContribution {
  sourceId: string;
  choices: readonly CommandCenterModelChoice[];
}

interface RegisteredContribution {
  token: symbol;
  contribution: CommandCenterModelContribution;
}

const registrations = new Map<string, RegisteredContribution>();
const listeners = new Set<() => void>();
let snapshot: readonly CommandCenterModelContribution[] = [];

function publish(): void {
  snapshot = Array.from(registrations.values(), (entry) => entry.contribution);
  for (const listener of listeners) {
    listener();
  }
}

export function registerCommandCenterModelContribution(
  contribution: CommandCenterModelContribution,
): () => void {
  const token = Symbol(contribution.sourceId);
  registrations.set(contribution.sourceId, { token, contribution });
  publish();

  return () => {
    if (registrations.get(contribution.sourceId)?.token !== token) {
      return;
    }
    registrations.delete(contribution.sourceId);
    publish();
  };
}

export function subscribeCommandCenterModelContributions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCommandCenterModelContributions(): readonly CommandCenterModelContribution[] {
  return snapshot;
}

export function useCommandCenterModelContributions(): readonly CommandCenterModelContribution[] {
  return useSyncExternalStore(
    subscribeCommandCenterModelContributions,
    getCommandCenterModelContributions,
    getCommandCenterModelContributions,
  );
}

export function useCommandCenterModelRegistration(input: {
  active: boolean;
  contribution: CommandCenterModelContribution;
}): void {
  useEffect(() => {
    if (!input.active) {
      return;
    }
    return registerCommandCenterModelContribution(input.contribution);
  }, [input.active, input.contribution]);
}

export const __private__ = {
  clear() {
    registrations.clear();
    publish();
  },
};
