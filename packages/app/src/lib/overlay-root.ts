import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

/** Shared web portal root with opener-relative layering and one active focus scope. */
export function getOverlayRoot(): HTMLElement {
  let element = document.getElementById("overlay-root");
  if (!element) {
    element = document.createElement("div");
    element.id = "overlay-root";
    element.style.position = "fixed";
    element.style.inset = "0";
    element.style.pointerEvents = "none";
    document.body.appendChild(element);
  }
  return element;
}

export const OVERLAY_Z = {
  floating: 10,
  modal: 20,
  toast: 10_000,
  tooltip: 20_000,
} as const;

type OverlayKind = "floating" | "modal";
type WebOverlayKeyHandler = (event: KeyboardEvent) => boolean;

const OverlayLayerContext = createContext(0);

export function useOverlayLayer(kind: OverlayKind): number {
  return useContext(OverlayLayerContext) + OVERLAY_Z[kind];
}

export function useCurrentOverlayLayer(): number {
  return useContext(OverlayLayerContext);
}

export function OverlayLayerProvider({ layer, children }: { layer: number; children?: ReactNode }) {
  return createElement(OverlayLayerContext.Provider, { value: layer }, children);
}

interface WebOverlayEntry {
  id: symbol;
  order: number;
  getLayer: () => number;
  getScope: () => HTMLElement | null;
  getKeyHandler: () => WebOverlayKeyHandler;
  restoreFocus: HTMLElement | null;
}

const webOverlayEntries: WebOverlayEntry[] = [];
let webOverlayOrder = 0;
let webOverlayListenersAttached = false;
let webOverlayFocusCheckQueued = false;

function getTopWebOverlay(): WebOverlayEntry | undefined {
  return webOverlayEntries.reduce<WebOverlayEntry | undefined>((top, entry) => {
    if (!top) return entry;
    const layerDifference = entry.getLayer() - top.getLayer();
    return layerDifference > 0 || (layerDifference === 0 && entry.order > top.order) ? entry : top;
  }, undefined);
}

/** Global hosts live outside their opener tree, so resolve above the active opener at open time. */
export function useGlobalWebOverlayLayer(kind: OverlayKind, active: boolean): number {
  const contextualLayer = useOverlayLayer(kind);
  return useMemo(() => {
    if (!active) return contextualLayer;
    const topLayer = getTopWebOverlay()?.getLayer() ?? 0;
    return Math.max(contextualLayer, topLayer + OVERLAY_Z[kind]);
  }, [active, contextualLayer, kind]);
}

function getFocusableElements(scope: HTMLElement): HTMLElement[] {
  const selector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");
  return Array.from(scope.querySelectorAll<HTMLElement>(selector)).filter(
    (element) =>
      element.getAttribute("aria-hidden") !== "true" &&
      !element.hasAttribute("hidden") &&
      element.getClientRects().length > 0,
  );
}

function focusFirstElement(scope: HTMLElement): void {
  const first = getFocusableElements(scope)[0];
  (first ?? scope).focus();
}

function handleWebOverlayFocus(event: FocusEvent): void {
  const scope = getTopWebOverlay()?.getScope();
  if (!scope || scope.contains(event.target as Node) || webOverlayFocusCheckQueued) return;
  webOverlayFocusCheckQueued = true;
  queueMicrotask(() => {
    webOverlayFocusCheckQueued = false;
    const currentScope = getTopWebOverlay()?.getScope();
    if (!currentScope || currentScope.contains(document.activeElement)) return;
    focusFirstElement(currentScope);
  });
}

function handleWebOverlayKeyDown(event: KeyboardEvent): void {
  const top = getTopWebOverlay();
  const scope = top?.getScope();
  if (!top || !scope) return;
  if (event.key === "Tab") {
    const focusable = getFocusableElements(scope);
    const first = focusable[0];
    const last = focusable.at(-1);
    const active = document.activeElement;
    const wrapBackward = event.shiftKey && (!scope.contains(active) || active === first);
    const wrapForward = !event.shiftKey && (!scope.contains(active) || active === last);
    if (wrapBackward || wrapForward) {
      event.preventDefault();
      event.stopImmediatePropagation();
      (wrapBackward ? last : first)?.focus();
      if (!first) scope.focus();
      return;
    }
  }
  if (!top.getKeyHandler()(event)) return;
  event.stopImmediatePropagation();
}

function attachWebOverlayListeners(): void {
  if (webOverlayListenersAttached) return;
  window.addEventListener("keydown", handleWebOverlayKeyDown, true);
  document.addEventListener("focusin", handleWebOverlayFocus, true);
  webOverlayListenersAttached = true;
}

function detachWebOverlayListeners(): void {
  if (!webOverlayListenersAttached || webOverlayEntries.length > 0) return;
  window.removeEventListener("keydown", handleWebOverlayKeyDown, true);
  document.removeEventListener("focusin", handleWebOverlayFocus, true);
  webOverlayListenersAttached = false;
}

function addWebOverlay(entry: WebOverlayEntry): () => void {
  webOverlayEntries.push(entry);
  attachWebOverlayListeners();
  const focusFrame = window.requestAnimationFrame(() => {
    const scope = entry.getScope();
    if (getTopWebOverlay() === entry && scope && !scope.contains(document.activeElement)) {
      focusFirstElement(scope);
    }
  });
  return () => {
    window.cancelAnimationFrame(focusFrame);
    const index = webOverlayEntries.findIndex((candidate) => candidate.id === entry.id);
    if (index !== -1) webOverlayEntries.splice(index, 1);
    detachWebOverlayListeners();
    if (entry.restoreFocus && document.contains(entry.restoreFocus)) {
      entry.restoreFocus.focus();
    }
  };
}

export function useWebOverlayRegistration({
  active,
  layer,
  onKeyDown,
}: {
  active: boolean;
  layer: number;
  onKeyDown: WebOverlayKeyHandler;
}) {
  const idRef = useRef(Symbol("web-overlay"));
  const scopeRef = useRef<HTMLElement | null>(null);
  const layerRef = useRef(layer);
  const keyHandlerRef = useRef(onKeyDown);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const removeEntryRef = useRef<(() => void) | null>(null);
  const activeRef = useRef(active);
  const wasActiveRef = useRef(false);

  activeRef.current = active;
  layerRef.current = layer;
  keyHandlerRef.current = onKeyDown;
  if (active && !wasActiveRef.current && typeof document !== "undefined") {
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasActiveRef.current = active;

  const syncRegistration = useCallback(() => {
    const shouldRegister =
      activeRef.current &&
      scopeRef.current != null &&
      typeof window !== "undefined" &&
      typeof document !== "undefined";
    if (!shouldRegister) {
      removeEntryRef.current?.();
      removeEntryRef.current = null;
      return;
    }
    if (removeEntryRef.current) return;
    const entry: WebOverlayEntry = {
      id: idRef.current,
      order: ++webOverlayOrder,
      getLayer: () => layerRef.current,
      getScope: () => scopeRef.current,
      getKeyHandler: () => keyHandlerRef.current,
      restoreFocus: restoreFocusRef.current,
    };
    removeEntryRef.current = addWebOverlay(entry);
  }, []);

  const setScope = useCallback(
    (node: unknown) => {
      scopeRef.current =
        typeof HTMLElement !== "undefined" && node instanceof HTMLElement ? node : null;
      syncRegistration();
    },
    [syncRegistration],
  );

  useLayoutEffect(() => {
    syncRegistration();
    return () => {
      removeEntryRef.current?.();
      removeEntryRef.current = null;
    };
  }, [active, syncRegistration]);

  return setScope;
}
