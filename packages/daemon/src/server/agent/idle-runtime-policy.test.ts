import { expect, test } from "vitest";

import {
  AGENT_IDLE_RUNTIME_SWEEP_INTERVAL_MS,
  AGENT_IDLE_RUNTIME_TTL_MS,
} from "./idle-runtime-policy.js";

test("idle Provider runtime policy uses the approved conservative residency window", () => {
  expect(AGENT_IDLE_RUNTIME_TTL_MS).toBe(30 * 60 * 1000);
  expect(AGENT_IDLE_RUNTIME_SWEEP_INTERVAL_MS).toBe(60 * 1000);
});
