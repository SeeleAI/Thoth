import type {
  ThothLoopPlanExecResultInput,
  ThothLoopReportBlockedInput,
  ThothLoopReviewIndependentAssessmentInput,
  ThothLoopReviewVerdictInput,
} from "@thoth/protocol/thoth-runtime-contract";
import type { ThothToolExecutionContext } from "@thoth/drivers/agent-runtime";

export type ForegroundToolFenceKind = "raw_provider" | "thoth_clarify";

interface ForegroundToolFence {
  workspaceId: string;
  generation: string;
  kind: ForegroundToolFenceKind;
  foregroundTurnId: string;
  providerTurnId: string | null;
  parked: boolean;
}

export interface ExecutionToolBinding {
  workspaceId: string;
  taskId: string;
  goalId: string;
  executionId: string;
  generation: string;
  phase: "planexec" | "review";
}

export interface ScopedCapabilityAuthority {
  workspaceId: string;
  agentId: string;
  executionId: string;
  generation: string;
}

export interface ToolResultSink {
  submitPlanExec(input: {
    binding: ExecutionToolBinding;
    result: ThothLoopPlanExecResultInput;
    providerTurnId?: string;
    callId: string;
  }): boolean;
  submitReviewAssessment(input: {
    binding: ExecutionToolBinding;
    assessment: ThothLoopReviewIndependentAssessmentInput;
    providerTurnId?: string;
  }): string | null;
  submitReviewVerdict(input: {
    binding: ExecutionToolBinding;
    verdict: ThothLoopReviewVerdictInput;
    providerTurnId?: string;
    callId: string;
  }): boolean;
  reportBlocked(input: {
    binding: ExecutionToolBinding;
    report: ThothLoopReportBlockedInput;
    providerTurnId?: string;
  }): boolean;
}

export class ThothRuntimeInactiveError extends Error {
  readonly code = "THOTH_RUNTIME_INACTIVE";

  constructor(message = "Thoth RuntimeBundle is inactive for this provider turn") {
    super(message);
    this.name = "ThothRuntimeInactiveError";
  }
}

/** Generation-scoped semantic tool gateway shared by native, MCP and ACP transports. */
export class ToolGateway {
  private readonly bindings = new Map<string, ExecutionToolBinding>();
  private readonly foreground = new Map<string, ForegroundToolFence>();
  private readonly parkedProviderTurns = new Map<string, Set<string>>();

  constructor(private readonly sink: ToolResultSink) {}

  bind(agentId: string, binding: ExecutionToolBinding): () => void {
    this.bindings.set(agentId, binding);
    return () => {
      if (this.bindings.get(agentId) === binding) {
        this.bindings.delete(agentId);
      }
    };
  }

  beginForegroundTurn(input: {
    agentId: string;
    workspaceId: string;
    generation: string;
    kind: ForegroundToolFenceKind;
    foregroundTurnId: string;
  }): void {
    this.foreground.set(input.agentId, {
      workspaceId: input.workspaceId,
      generation: input.generation,
      kind: input.kind,
      foregroundTurnId: input.foregroundTurnId,
      providerTurnId: null,
      parked: false,
    });
  }

  getActiveForegroundAuthorityTurnId(agentId: string): string | null {
    const fence = this.foreground.get(agentId);
    return fence?.kind === "thoth_clarify" ? fence.foregroundTurnId : null;
  }

  getActiveForegroundTurnId(agentId: string): string | null {
    return this.foreground.get(agentId)?.foregroundTurnId ?? null;
  }

  getBoundForegroundProviderTurnId(agentId: string): string | null {
    return this.foreground.get(agentId)?.providerTurnId ?? null;
  }

  bindForegroundProviderTurn(input: {
    agentId: string;
    generation: string;
    providerTurnId: string;
  }): void {
    const current = this.foreground.get(input.agentId);
    if (current?.generation === input.generation) {
      this.foreground.set(input.agentId, { ...current, providerTurnId: input.providerTurnId });
    }
  }

  endForegroundTurn(input: { agentId: string; generation: string }): void {
    if (this.foreground.get(input.agentId)?.generation === input.generation) {
      this.foreground.delete(input.agentId);
    }
  }

  parkForegroundTurn(input: { agentId: string; providerTurnId: string }): void {
    const current = this.foreground.get(input.agentId);
    if (!current || current.providerTurnId !== input.providerTurnId) return;
    this.foreground.set(input.agentId, { ...current, parked: true });
    const parked = this.parkedProviderTurns.get(input.agentId) ?? new Set<string>();
    parked.add(input.providerTurnId);
    this.parkedProviderTurns.set(input.agentId, parked);
  }

  isParkedProviderTurn(input: { agentId: string; providerTurnId?: string }): boolean {
    return Boolean(
      input.providerTurnId &&
      this.parkedProviderTurns.get(input.agentId)?.has(input.providerTurnId),
    );
  }

  releaseParkedProviderTurn(input: { agentId: string; providerTurnId?: string }): void {
    if (!input.providerTurnId) return;
    const parked = this.parkedProviderTurns.get(input.agentId);
    parked?.delete(input.providerTurnId);
    if (parked?.size === 0) this.parkedProviderTurns.delete(input.agentId);
  }

  assertForegroundAuthorityTurn(input: {
    agentId: string;
    context: ThothToolExecutionContext;
  }): void {
    const fence = this.foreground.get(input.agentId);
    if (!fence) throw new ThothRuntimeInactiveError();
    if (fence.kind === "raw_provider") {
      throw new ThothRuntimeInactiveError();
    }
    this.assertCurrentProviderTurn(input.agentId, fence, input.context);
  }

  assertForegroundContextTurn(input: {
    agentId: string;
    context: ThothToolExecutionContext;
  }): string {
    const fence = this.foreground.get(input.agentId);
    if (!fence) throw new Error("No active foreground turn owns this context tool call");
    this.assertCurrentProviderTurn(input.agentId, fence, input.context);
    return fence.foregroundTurnId;
  }

  authorizeScopedCapability(input: {
    agentId: string;
    context: ThothToolExecutionContext;
  }): ScopedCapabilityAuthority {
    const foreground = this.foreground.get(input.agentId);
    if (foreground) {
      this.assertCurrentProviderTurn(input.agentId, foreground, input.context);
      return {
        workspaceId: foreground.workspaceId,
        agentId: input.agentId,
        executionId: foreground.foregroundTurnId,
        generation: foreground.generation,
      };
    }

    const binding = this.bindings.get(input.agentId);
    if (!binding) {
      throw new Error("No active Workspace-scoped execution owns this capability call");
    }
    if (input.context.providerToolCall?.isActiveProviderTurn !== true) {
      throw new Error("Scoped capability calls require an active provider execution");
    }
    return {
      workspaceId: binding.workspaceId,
      agentId: input.agentId,
      executionId: binding.executionId,
      generation: binding.generation,
    };
  }

  submitPlanExec(
    agentId: string,
    result: ThothLoopPlanExecResultInput,
    providerTurnId: string | undefined,
    callId: string,
  ): boolean {
    const binding = this.binding(agentId, "planexec");
    return binding ? this.sink.submitPlanExec({ binding, result, providerTurnId, callId }) : false;
  }

  submitReviewAssessment(
    agentId: string,
    assessment: ThothLoopReviewIndependentAssessmentInput,
    providerTurnId?: string,
  ): string | null {
    const binding = this.binding(agentId, "review");
    return binding
      ? this.sink.submitReviewAssessment({ binding, assessment, providerTurnId })
      : null;
  }

  submitReviewVerdict(
    agentId: string,
    verdict: ThothLoopReviewVerdictInput,
    providerTurnId: string | undefined,
    callId: string,
  ): boolean {
    const binding = this.binding(agentId, "review");
    return binding
      ? this.sink.submitReviewVerdict({ binding, verdict, providerTurnId, callId })
      : false;
  }

  reportBlocked(
    agentId: string,
    report: ThothLoopReportBlockedInput,
    providerTurnId?: string,
  ): boolean {
    const binding = this.bindings.get(agentId);
    return binding ? this.sink.reportBlocked({ binding, report, providerTurnId }) : false;
  }

  private binding(
    agentId: string,
    phase: ExecutionToolBinding["phase"],
  ): ExecutionToolBinding | null {
    const binding = this.bindings.get(agentId);
    return binding?.phase === phase ? binding : null;
  }

  private assertCurrentProviderTurn(
    agentId: string,
    fence: ForegroundToolFence,
    context: ThothToolExecutionContext,
  ): void {
    if (fence.parked) throw new Error("A parked provider turn cannot call foreground Thoth tools");
    const providerTurnId = context.providerToolCall?.turnId;
    if (fence.providerTurnId === null) {
      if (!providerTurnId || context.providerToolCall?.isActiveProviderTurn !== true) {
        throw new Error("Provider turn is not bound to the active foreground generation");
      }
      this.foreground.set(agentId, { ...fence, providerTurnId });
      return;
    }
    if (!providerTurnId || providerTurnId !== fence.providerTurnId) {
      throw new Error("A stale provider turn cannot submit Agent authority");
    }
  }

  resetForTest(): void {
    this.bindings.clear();
    this.foreground.clear();
    this.parkedProviderTurns.clear();
  }
}
