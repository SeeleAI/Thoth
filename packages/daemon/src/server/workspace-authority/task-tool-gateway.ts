import type {
  ThothLoopPlanExecResultInput,
  ThothLoopReportBlockedInput,
  ThothLoopReviewIndependentAssessmentInput,
  ThothLoopReviewVerdictInput,
} from "@thoth/protocol/thoth-runtime-contract";

export interface TaskToolExecutionBinding {
  workspaceId: string;
  taskId: string;
  goalId: string;
  executionId: string;
  generation: string;
  phase: "planexec" | "review";
}

export interface TaskSemanticResultSink {
  submitPlanExec(input: {
    binding: TaskToolExecutionBinding;
    result: ThothLoopPlanExecResultInput;
    providerTurnId?: string;
    callId: string;
  }): boolean;
  submitReviewAssessment(input: {
    binding: TaskToolExecutionBinding;
    assessment: ThothLoopReviewIndependentAssessmentInput;
    providerTurnId?: string;
  }): string | null;
  submitReviewVerdict(input: {
    binding: TaskToolExecutionBinding;
    verdict: ThothLoopReviewVerdictInput;
    providerTurnId?: string;
    callId: string;
  }): boolean;
  reportBlocked(input: {
    binding: TaskToolExecutionBinding;
    report: ThothLoopReportBlockedInput;
    providerTurnId?: string;
  }): boolean;
}

/** Generation-scoped semantic tool gateway shared by native, MCP and ACP transports. */
export class TaskToolGateway {
  private readonly bindings = new Map<string, TaskToolExecutionBinding>();

  constructor(private readonly sink: TaskSemanticResultSink) {}

  bind(agentId: string, binding: TaskToolExecutionBinding): () => void {
    this.bindings.set(agentId, binding);
    return () => {
      if (this.bindings.get(agentId) === binding) {
        this.bindings.delete(agentId);
      }
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
    phase: TaskToolExecutionBinding["phase"],
  ): TaskToolExecutionBinding | null {
    const binding = this.bindings.get(agentId);
    return binding?.phase === phase ? binding : null;
  }
}
