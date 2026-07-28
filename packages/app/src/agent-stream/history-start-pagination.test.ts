import { describe, expect, it } from "vitest";
import {
  createHistoryStartPaginationState,
  evaluateHistoryStartPagination,
  rearmHistoryStartPagination,
} from "./history-start-pagination";

const visibleHistoryStart = {
  distanceFromHistoryStart: 0,
  hasOlderHistory: true,
  isLoadingOlderHistory: false,
  isReady: true,
  progressKey: "epoch-1:20",
};

describe("history start pagination", () => {
  it("loads once for each canonical history cursor", () => {
    const first = evaluateHistoryStartPagination(
      createHistoryStartPaginationState(),
      visibleHistoryStart,
    );
    const duplicate = evaluateHistoryStartPagination(first.state, visibleHistoryStart);
    const nextPage = evaluateHistoryStartPagination(first.state, {
      ...visibleHistoryStart,
      progressKey: "epoch-1:10",
    });

    expect([first.shouldLoad, duplicate.shouldLoad, nextPage.shouldLoad]).toEqual([
      true,
      false,
      true,
    ]);
  });

  it("re-arms after leaving the edge or making another upward edge gesture", () => {
    const first = evaluateHistoryStartPagination(
      createHistoryStartPaginationState(),
      visibleHistoryStart,
    );
    const away = evaluateHistoryStartPagination(first.state, {
      ...visibleHistoryStart,
      distanceFromHistoryStart: 200,
    });
    const returned = evaluateHistoryStartPagination(away.state, visibleHistoryStart);
    const gestureRetry = evaluateHistoryStartPagination(
      rearmHistoryStartPagination(),
      visibleHistoryStart,
    );

    expect([
      first.shouldLoad,
      away.shouldLoad,
      returned.shouldLoad,
      gestureRetry.shouldLoad,
    ]).toEqual([true, false, true, true]);
  });

  it("never overlaps a request or loads without canonical progress", () => {
    const state = createHistoryStartPaginationState();
    expect([
      evaluateHistoryStartPagination(state, { ...visibleHistoryStart, isReady: false }).shouldLoad,
      evaluateHistoryStartPagination(state, { ...visibleHistoryStart, hasOlderHistory: false })
        .shouldLoad,
      evaluateHistoryStartPagination(state, {
        ...visibleHistoryStart,
        isLoadingOlderHistory: true,
      }).shouldLoad,
      evaluateHistoryStartPagination(state, { ...visibleHistoryStart, progressKey: null })
        .shouldLoad,
    ]).toEqual([false, false, false, false]);
  });
});
