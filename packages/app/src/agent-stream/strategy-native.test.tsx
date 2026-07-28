/**
 * @vitest-environment jsdom
 */
import React, { act, forwardRef, useImperativeHandle } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamSegmentRenderers, StreamViewportHandle } from "./strategy";
import { createNativeStreamStrategy } from "./strategy-native";

const nativeState = vi.hoisted(() => ({
  platform: "android",
  flatListProps: null as Record<string, unknown> | null,
  bottomInput: null as Record<string, unknown> | null,
  scrollToOffset: vi.fn(),
  controller: {
    mode: "sticky-bottom" as "sticky-bottom" | "detached",
    requestLocalAnchor: vi.fn(),
    beginUserScroll: vi.fn(),
    endUserScroll: vi.fn(),
    detachByUser: vi.fn(),
    handleViewportMetricsChange: vi.fn(),
    handleContentSizeChange: vi.fn(),
    prepareForStickyViewportChange: vi.fn(),
    prepareForStickyContentChange: vi.fn(),
    handleScrollNearBottomChange: vi.fn(),
    reevaluate: vi.fn(),
  },
}));

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return nativeState.platform;
    },
    select: (values: Record<string, unknown>) => values[nativeState.platform] ?? values.default,
  },
  FlatList: forwardRef((props: Record<string, unknown>, ref: React.ForwardedRef<unknown>) => {
    nativeState.flatListProps = props;
    useImperativeHandle(ref, () => ({ scrollToOffset: nativeState.scrollToOffset }));
    return React.createElement("div", { "data-testid": props.testID });
  }),
  ActivityIndicator: () => React.createElement("span", null, "loading"),
  Keyboard: {
    addListener: () => ({ remove: () => {} }),
  },
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children),
}));

vi.mock("./bottom-anchor-controller", () => ({
  useBottomAnchorController: (input: Record<string, unknown>) => {
    nativeState.bottomInput = input;
    return nativeState.controller;
  },
}));

function createRenderers(): StreamSegmentRenderers {
  return {
    renderHistoryVirtualizedRow: () => null,
    renderHistoryMountedRow: () => null,
    renderLiveHeadRow: () => null,
    renderLiveAuxiliary: () => null,
  };
}

function nativeScrollEvent(offsetY: number) {
  return {
    nativeEvent: {
      contentOffset: { x: 0, y: offsetY },
      contentSize: { width: 400, height: 1_200 },
      layoutMeasurement: { width: 400, height: 600 },
    },
  };
}

describe("createNativeStreamStrategy", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let frameSequence = 0;
  let frames: Map<number, FrameRequestCallback>;

  function render() {
    const strategy = createNativeStreamStrategy();
    const viewportRef = React.createRef<StreamViewportHandle>();
    act(() => {
      root?.render(
        strategy.render({
          agentId: "agent",
          segments: {
            historyVirtualized: [],
            historyMounted: [],
            liveHead: [],
          },
          boundary: {
            hasVirtualizedHistory: false,
            hasMountedHistory: false,
            hasLiveHead: false,
          },
          renderers: createRenderers(),
          listEmptyComponent: null,
          viewportRef,
          routeBottomAnchorRequest: null,
          isAuthoritativeHistoryReady: true,
          onNearBottomChange: vi.fn(),
          onNearHistoryStart: vi.fn(),
          isLoadingOlderHistory: false,
          hasOlderHistory: false,
          olderHistoryProgressKey: null,
          scrollEnabled: true,
          listStyle: null,
          baseListContentContainerStyle: null,
          forwardListContentContainerStyle: null,
        }),
      );
    });
  }

  function flushFrames() {
    const pending = [...frames.entries()];
    frames.clear();
    for (const [id, callback] of pending) {
      callback(id);
    }
  }

  beforeEach(() => {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
      configurable: true,
      value: true,
    });
    nativeState.platform = "android";
    nativeState.flatListProps = null;
    nativeState.bottomInput = null;
    nativeState.controller.mode = "sticky-bottom";
    nativeState.scrollToOffset.mockReset();
    for (const method of Object.values(nativeState.controller)) {
      if (typeof method === "function" && "mockReset" in method) {
        method.mockReset();
      }
    }
    frameSequence = 0;
    frames = new Map();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = ++frameSequence;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.delete(id);
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    root = null;
    container?.remove();
    container = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lets the controller exclusively maintain Android sticky-bottom position", () => {
    render();

    expect(nativeState.flatListProps?.maintainVisibleContentPosition).toBeUndefined();

    nativeState.controller.mode = "detached";
    render();

    expect(nativeState.flatListProps?.maintainVisibleContentPosition).toEqual({
      minIndexForVisible: 0,
      autoscrollToTopThreshold: 0,
    });
  });

  it("suspends sticky maintenance while a drag owns the viewport", () => {
    render();
    const props = nativeState.flatListProps;
    const bottomInput = nativeState.bottomInput;
    if (!props || !bottomInput) {
      throw new Error("Expected native stream consumer bindings");
    }

    const scrollToBottom = bottomInput.scrollToBottom as (animated: boolean) => void;
    const onScrollBeginDrag = props.onScrollBeginDrag as () => void;
    const onScroll = props.onScroll as (event: ReturnType<typeof nativeScrollEvent>) => void;
    const onScrollEndDrag = props.onScrollEndDrag as (
      event: ReturnType<typeof nativeScrollEvent>,
    ) => void;

    act(() => {
      scrollToBottom(false);
      onScrollBeginDrag();
      onScroll(nativeScrollEvent(4));
      onScrollEndDrag(nativeScrollEvent(80));
    });

    expect(nativeState.controller.beginUserScroll).toHaveBeenCalledTimes(1);
    expect(nativeState.controller.handleScrollNearBottomChange).toHaveBeenCalledTimes(1);
    expect(nativeState.controller.endUserScroll).not.toHaveBeenCalled();

    act(() => flushFrames());

    expect(nativeState.controller.endUserScroll).toHaveBeenCalledWith({ isNearBottom: false });
  });

  it("lets momentum own drag completion and reports its final position once", () => {
    render();
    const props = nativeState.flatListProps;
    if (!props) {
      throw new Error("Expected native stream consumer bindings");
    }

    const onScrollBeginDrag = props.onScrollBeginDrag as () => void;
    const onScrollEndDrag = props.onScrollEndDrag as (
      event: ReturnType<typeof nativeScrollEvent>,
    ) => void;
    const onMomentumScrollBegin = props.onMomentumScrollBegin as () => void;
    const onMomentumScrollEnd = props.onMomentumScrollEnd as (
      event: ReturnType<typeof nativeScrollEvent>,
    ) => void;

    act(() => {
      onScrollBeginDrag();
      onScrollEndDrag(nativeScrollEvent(80));
      onMomentumScrollBegin();
      flushFrames();
    });
    expect(nativeState.controller.endUserScroll).not.toHaveBeenCalled();

    act(() => onMomentumScrollEnd(nativeScrollEvent(0)));
    expect(nativeState.controller.endUserScroll).toHaveBeenCalledTimes(1);
    expect(nativeState.controller.endUserScroll).toHaveBeenCalledWith({ isNearBottom: true });
  });
});
