import type { ThothClarifyJudgeContractInput } from "@thoth/protocol/thoth-runtime-contract";

interface PendingChallenge {
  resolve(value: ThothClarifyJudgeContractInput): void;
  reject(error: Error): void;
}

const pending = new Map<string, PendingChallenge>();

export function waitForClarifyChallenge(agentId: string): Promise<ThothClarifyJudgeContractInput> {
  if (pending.has(agentId)) throw new Error(`Clarify Challenger ${agentId} is already waiting`);
  return new Promise((resolve, reject) => {
    pending.set(agentId, { resolve, reject });
  });
}

export function resolveClarifyChallenge(
  agentId: string,
  result: ThothClarifyJudgeContractInput,
): boolean {
  const request = pending.get(agentId);
  if (!request) return false;
  pending.delete(agentId);
  request.resolve(result);
  return true;
}

export function rejectClarifyChallenge(agentId: string, reason: string): boolean {
  const request = pending.get(agentId);
  if (!request) return false;
  pending.delete(agentId);
  request.reject(new Error(reason));
  return true;
}

export function resetClarifyChallengeBrokerForTest(): void {
  for (const [agentId, request] of pending) {
    request.reject(new Error(`Clarify Challenger ${agentId} reset`));
  }
  pending.clear();
}
