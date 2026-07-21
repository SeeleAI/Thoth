import { createHash } from "node:crypto";

export function deriveDurableGoalId(input: {
  taskId: string;
  sourceGoalId: string;
  order: number;
  lineage: string;
}): string {
  const digest = createHash("sha256")
    .update(input.taskId)
    .update("\0")
    .update(input.lineage)
    .update("\0")
    .update(input.sourceGoalId)
    .update("\0")
    .update(String(input.order))
    .digest("hex")
    .slice(0, 32);
  return `goal-${digest}`;
}
