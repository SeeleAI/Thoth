export interface ApprovalClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const SYSTEM_APPROVAL_CLOCK: ApprovalClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface ScheduledApproval {
  executionId: string;
  handle: unknown;
}

/** Owns only process timers; SQLite remains the approval authority. */
export class ExecutionApprovalController {
  private readonly scheduled = new Map<string, ScheduledApproval>();

  constructor(private readonly clock: ApprovalClock = SYSTEM_APPROVAL_CLOCK) {}

  deadlineAfter(delayMs: number): string {
    return new Date(this.clock.now() + Math.max(0, delayMs)).toISOString();
  }

  schedule(input: {
    approvalId: string;
    executionId: string;
    deadlineAt: string;
    onDeadline: () => void | Promise<void>;
  }): void {
    this.cancel(input.approvalId);
    const delayMs = Math.max(0, Date.parse(input.deadlineAt) - this.clock.now());
    const handle = this.clock.setTimeout(() => {
      this.scheduled.delete(input.approvalId);
      void input.onDeadline();
    }, delayMs);
    this.scheduled.set(input.approvalId, { executionId: input.executionId, handle });
  }

  cancel(approvalId: string): void {
    const current = this.scheduled.get(approvalId);
    if (!current) return;
    this.clock.clearTimeout(current.handle);
    this.scheduled.delete(approvalId);
  }

  cancelExecution(executionId: string): void {
    for (const [approvalId, scheduled] of this.scheduled) {
      if (scheduled.executionId === executionId) {
        this.clock.clearTimeout(scheduled.handle);
        this.scheduled.delete(approvalId);
      }
    }
  }

  clear(): void {
    for (const scheduled of this.scheduled.values()) {
      this.clock.clearTimeout(scheduled.handle);
    }
    this.scheduled.clear();
  }
}
