import type { HarnessExecutionDescriptor } from "@thoth/drivers/harness";
import type { ExecutionProjection } from "@thoth/protocol/task-authority";

interface ActiveExecutionRuntime {
  workspaceId: string;
  taskId: string;
  generation: string;
  execution: HarnessExecutionDescriptor;
  interrupt: () => Promise<void>;
}

/**
 * Ephemeral process bindings for durable ExecutionAttempts. Losing this map is
 * not losing task truth: recovery resumes from provider_threads instead.
 */
export class ExecutionRuntimeRegistry {
  private readonly active = new Map<string, ActiveExecutionRuntime>();

  register(input: ActiveExecutionRuntime): () => void {
    this.active.set(input.execution.id, input);
    return () => {
      if (this.active.get(input.execution.id) === input) {
        this.active.delete(input.execution.id);
      }
    };
  }

  async interrupt(input: {
    workspaceId: string;
    execution: ExecutionProjection;
  }): Promise<"confirmed" | "orphaned"> {
    const runtime = this.active.get(input.execution.id);
    if (
      !runtime ||
      runtime.workspaceId !== input.workspaceId ||
      runtime.taskId !== input.execution.taskId ||
      runtime.generation !== input.execution.generation
    ) {
      return "orphaned";
    }
    try {
      await runtime.interrupt();
      this.active.delete(input.execution.id);
      return "confirmed";
    } catch {
      return "orphaned";
    }
  }

  clear(): void {
    this.active.clear();
  }
}
