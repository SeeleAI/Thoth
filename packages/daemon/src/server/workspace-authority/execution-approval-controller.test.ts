import { describe, expect, it, vi } from "vitest";
import {
  ExecutionApprovalController,
  type ApprovalClock,
} from "./execution-approval-controller.js";

class FakeApprovalClock implements ApprovalClock {
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  constructor(private currentMs: number) {}

  now(): number {
    return this.currentMs;
  }

  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.nextId++;
    this.timers.set(id, { at: this.currentMs + Math.max(0, delayMs), callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  advanceTo(targetMs: number): void {
    if (targetMs < this.currentMs) throw new Error("Fake clock cannot move backward");
    this.currentMs = targetMs;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= this.currentMs)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      if (!due) return;
      this.timers.delete(due[0]);
      due[1].callback();
    }
  }
}

describe("ExecutionApprovalController", () => {
  it("keeps the full human window and fires exactly at the 20-second deadline", async () => {
    const start = Date.parse("2026-07-22T00:00:00.000Z");
    const clock = new FakeApprovalClock(start);
    const controller = new ExecutionApprovalController(clock);
    const onDeadline = vi.fn(async () => undefined);
    const deadlineAt = controller.deadlineAfter(20_000);
    controller.schedule({
      approvalId: "approval-1",
      executionId: "execution-1",
      deadlineAt,
      onDeadline,
    });

    clock.advanceTo(start + 19_999);
    expect(onDeadline).not.toHaveBeenCalled();
    clock.advanceTo(start + 20_000);
    await Promise.resolve();
    expect(onDeadline).toHaveBeenCalledTimes(1);
    clock.advanceTo(start + 60_000);
    expect(onDeadline).toHaveBeenCalledTimes(1);
  });

  it("cancels the pending timeout when a human decision or Stop wins first", () => {
    const start = Date.parse("2026-07-22T00:00:00.000Z");
    const clock = new FakeApprovalClock(start);
    const controller = new ExecutionApprovalController(clock);
    const humanWins = vi.fn();
    const stopWins = vi.fn();
    controller.schedule({
      approvalId: "approval-human",
      executionId: "execution-human",
      deadlineAt: controller.deadlineAfter(20_000),
      onDeadline: humanWins,
    });
    controller.schedule({
      approvalId: "approval-stop",
      executionId: "execution-stop",
      deadlineAt: controller.deadlineAfter(20_000),
      onDeadline: stopWins,
    });

    clock.advanceTo(start + 19_999);
    controller.cancel("approval-human");
    controller.cancelExecution("execution-stop");
    clock.advanceTo(start + 20_000);

    expect(humanWins).not.toHaveBeenCalled();
    expect(stopWins).not.toHaveBeenCalled();
  });

  it("reuses the durable deadline when a recoverable approval timer is rebuilt", async () => {
    const start = Date.parse("2026-07-22T00:00:00.000Z");
    const clock = new FakeApprovalClock(start);
    const firstController = new ExecutionApprovalController(clock);
    const deadlineAt = firstController.deadlineAfter(20_000);
    firstController.schedule({
      approvalId: "approval-restart",
      executionId: "execution-restart",
      deadlineAt,
      onDeadline: vi.fn(),
    });

    clock.advanceTo(start + 7_000);
    firstController.clear();
    const restoredController = new ExecutionApprovalController(clock);
    const restoredDeadline = vi.fn(async () => undefined);
    restoredController.schedule({
      approvalId: "approval-restart",
      executionId: "execution-restart",
      deadlineAt,
      onDeadline: restoredDeadline,
    });

    clock.advanceTo(start + 19_999);
    expect(restoredDeadline).not.toHaveBeenCalled();
    clock.advanceTo(start + 20_000);
    await Promise.resolve();
    expect(restoredDeadline).toHaveBeenCalledTimes(1);
  });
});
