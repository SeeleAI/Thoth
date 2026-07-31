import { z } from "zod";

export const ThothRuntimeModeSchema = z.enum(["quick", "loop"]);
export const ThothRuntimeClarifyStrengthSchema = z.enum([
  "none",
  "auto",
  "light",
  "balanced",
  "dive",
  "deep",
]);
export const ThothRuntimeLoopStrengthSchema = z.enum([
  "auto",
  "one_plan_one_do",
  "light",
  "balanced",
  "run_until_stopped",
]);

export type ThothRuntimeMode = z.infer<typeof ThothRuntimeModeSchema>;
export type ThothRuntimeClarifyStrength = z.infer<typeof ThothRuntimeClarifyStrengthSchema>;
export type ThothRuntimeLoopStrength = z.infer<typeof ThothRuntimeLoopStrengthSchema>;
