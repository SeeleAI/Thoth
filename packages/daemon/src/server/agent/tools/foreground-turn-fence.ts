import type { ThothToolExecutionContext } from "./types.js";

export type ForegroundTurnFenceKind = "raw_provider" | "thoth_clarify";

interface ForegroundTurnFenceRecord {
  generation: string;
  kind: ForegroundTurnFenceKind;
  foregroundTurnId: string;
  providerTurnId: string | null;
  parked: boolean;
}

/**
 * A visible Agent keeps one provider thread even when Thoth is turned off for a turn.
 * Dynamic tool registration is session-scoped for some providers, so this
 * registry fences authority calls at the per-turn boundary instead.
 */
const fences = new Map<string, ForegroundTurnFenceRecord>();
const parkedProviderTurns = new Map<string, Set<string>>();

export function beginForegroundTurnFence(input: {
  agentId: string;
  generation: string;
  kind: ForegroundTurnFenceKind;
  foregroundTurnId: string;
}): void {
  fences.set(input.agentId, {
    generation: input.generation,
    kind: input.kind,
    foregroundTurnId: input.foregroundTurnId,
    providerTurnId: null,
    parked: false,
  });
}

export function getActiveForegroundAuthorityTurnId(agentId: string): string | null {
  const fence = fences.get(agentId);
  return fence?.kind === "thoth_clarify" ? fence.foregroundTurnId : null;
}

export function bindForegroundProviderTurn(input: {
  agentId: string;
  generation: string;
  providerTurnId: string;
}): void {
  const current = fences.get(input.agentId);
  if (!current || current.generation !== input.generation) {
    return;
  }
  fences.set(input.agentId, { ...current, providerTurnId: input.providerTurnId });
}

export function endForegroundTurnFence(input: { agentId: string; generation: string }): void {
  if (fences.get(input.agentId)?.generation === input.generation) {
    fences.delete(input.agentId);
  }
}

export function parkForegroundTurnFence(input: { agentId: string; providerTurnId: string }): void {
  const current = fences.get(input.agentId);
  if (!current || current.providerTurnId !== input.providerTurnId) {
    return;
  }
  fences.set(input.agentId, { ...current, parked: true });
  const parked = parkedProviderTurns.get(input.agentId) ?? new Set<string>();
  parked.add(input.providerTurnId);
  parkedProviderTurns.set(input.agentId, parked);
}

export function isParkedForegroundProviderTurn(input: {
  agentId: string;
  providerTurnId: string | undefined;
}): boolean {
  return Boolean(
    input.providerTurnId && parkedProviderTurns.get(input.agentId)?.has(input.providerTurnId),
  );
}

export function releaseParkedForegroundProviderTurn(input: {
  agentId: string;
  providerTurnId: string | undefined;
}): void {
  if (!input.providerTurnId) {
    return;
  }
  const parked = parkedProviderTurns.get(input.agentId);
  parked?.delete(input.providerTurnId);
  if (parked?.size === 0) {
    parkedProviderTurns.delete(input.agentId);
  }
}

export function assertForegroundAuthorityTurn(input: {
  agentId: string;
  context: ThothToolExecutionContext;
}): void {
  const fence = fences.get(input.agentId);
  if (!fence) {
    throw new Error("No active Agent-scoped Thoth turn owns this tool call");
  }
  if (fence.kind === "raw_provider") {
    throw new Error("Thoth authority tools are disabled for this raw provider turn");
  }
  if (fence.parked) {
    throw new Error("A parked provider turn cannot submit another Agent authority card");
  }
  const providerTurnId = input.context.providerToolCall?.turnId;
  if (fence.providerTurnId === null) {
    if (!providerTurnId || input.context.providerToolCall?.isActiveProviderTurn !== true) {
      throw new Error("Provider turn is not bound to the active foreground generation");
    }
    fences.set(input.agentId, { ...fence, providerTurnId });
    return;
  }
  if (!providerTurnId || providerTurnId !== fence.providerTurnId) {
    throw new Error("A stale provider turn cannot submit Agent authority");
  }
}

export function resetForegroundTurnFencesForTest(): void {
  fences.clear();
  parkedProviderTurns.clear();
}
