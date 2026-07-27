import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __private__,
  getCommandCenterModelContributions,
  registerCommandCenterModelContribution,
  subscribeCommandCenterModelContributions,
  type CommandCenterModelContribution,
} from "./model-registry";

function contribution(sourceId: string): CommandCenterModelContribution {
  return { sourceId, choices: [] };
}

afterEach(() => __private__.clear());

describe("Command Center model contribution registry", () => {
  it("publishes focused owners and fences stale cleanup from a replacement", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCommandCenterModelContributions(listener);
    const unregisterOld = registerCommandCenterModelContribution(contribution("draft"));
    const replacement = contribution("draft");
    const unregisterNew = registerCommandCenterModelContribution(replacement);

    unregisterOld();
    expect(getCommandCenterModelContributions()).toEqual([replacement]);

    unregisterNew();
    expect(getCommandCenterModelContributions()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
  });
});
