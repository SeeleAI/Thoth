import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactElement,
} from "react";
import {
  Dimensions,
  Platform,
  Modal,
  Pressable,
  StatusBar,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Portal } from "@gorhom/portal";
import { useBottomSheetModalInternal } from "@gorhom/bottom-sheet";
import { FadeIn, FadeOut } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { FloatingSurface } from "@/components/ui/floating";
import { isWeb } from "@/constants/platform";
import {
  computeFloatingPosition,
  measureFloatingElement,
  useControllableOpenState,
  type FloatingAlign as Align,
  type FloatingRect as Rect,
  type FloatingSide as Side,
} from "@/components/ui/floating-core";

interface TooltipContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<View | null>;
  enabled: boolean;
  openOnPress: boolean;
  delayDuration: number;
}

const TooltipContext = createContext<TooltipContextValue | null>(null);

function useTooltipContext(componentName: string): TooltipContextValue {
  const ctx = useContext(TooltipContext);
  if (!ctx) {
    throw new Error(`${componentName} must be used within <Tooltip />`);
  }
  return ctx;
}

// Tooltips should open on hover or keyboard focus, not when focus is restored
// programmatically (e.g. when a Modal closes and returns focus to its opener).
// Track the last input modality on web so TooltipTrigger can ignore focus
// events that weren't keyboard-driven. Native has no equivalent scenario.
let lastInputWasKeyboard = false;
if (isWeb && typeof window !== "undefined") {
  const markKeyboard = () => {
    lastInputWasKeyboard = true;
  };
  const markPointer = () => {
    lastInputWasKeyboard = false;
  };
  window.addEventListener("keydown", markKeyboard, true);
  window.addEventListener("mousedown", markPointer, true);
  window.addEventListener("pointerdown", markPointer, true);
  window.addEventListener("touchstart", markPointer, true);
}

function shouldOpenOnFocus(): boolean {
  return !isWeb || lastInputWasKeyboard;
}

function isCallable(fn: unknown): fn is (...args: unknown[]) => void {
  return typeof fn === "function";
}

function composeEventHandlers(
  original: unknown,
  injected: (event: unknown) => void,
): (event: unknown) => void {
  return (event: unknown) => {
    if (isCallable(original)) {
      original(event);
    }
    injected(event);
  };
}

export function Tooltip({
  open,
  defaultOpen,
  onOpenChange,
  delayDuration = 0,
  enabledOnDesktop = true,
  enabledOnMobile = false,
  children,
}: PropsWithChildren<{
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  delayDuration?: number;
  enabledOnDesktop?: boolean;
  enabledOnMobile?: boolean;
}>): ReactElement {
  const triggerRef = useRef<View>(null);
  const [isOpen, setIsOpen] = useControllableOpenState({
    open,
    defaultOpen,
    onOpenChange,
  });

  const isCompact = useIsCompactFormFactor();
  const enabled = isCompact ? enabledOnMobile : enabledOnDesktop;

  const value = useMemo<TooltipContextValue>(
    () => ({
      open: isOpen,
      setOpen: setIsOpen,
      triggerRef,
      enabled,
      openOnPress: isCompact,
      delayDuration,
    }),
    [isOpen, setIsOpen, enabled, isCompact, delayDuration],
  );

  return <TooltipContext.Provider value={value}>{children}</TooltipContext.Provider>;
}

export function TooltipTrigger({
  children,
  disabled,
  onHoverIn,
  onHoverOut,
  onFocus,
  onBlur,
  onPress,
  asChild = false,
  triggerRefProp = "ref",
  ...props
}: PressableProps & {
  asChild?: boolean;
  triggerRefProp?: string;
}): ReactElement {
  const ctx = useTooltipContext("TooltipTrigger");
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }, []);

  const scheduleOpen = useCallback(() => {
    if (!ctx.enabled || disabled) return;
    clearOpenTimer();
    if (ctx.delayDuration <= 0) {
      ctx.setOpen(true);
      return;
    }
    openTimerRef.current = setTimeout(() => {
      ctx.setOpen(true);
      openTimerRef.current = null;
    }, ctx.delayDuration);
  }, [clearOpenTimer, ctx, disabled]);

  const close = useCallback(() => {
    clearOpenTimer();
    ctx.setOpen(false);
  }, [clearOpenTimer, ctx]);

  useEffect(() => {
    return () => {
      clearOpenTimer();
    };
  }, [clearOpenTimer]);

  const handleHoverIn = useCallback(
    (e?: unknown) => {
      if (isCallable(onHoverIn)) onHoverIn(e);
      scheduleOpen();
    },
    [onHoverIn, scheduleOpen],
  );

  const handleHoverOut = useCallback(
    (e?: unknown) => {
      if (isCallable(onHoverOut)) onHoverOut(e);
      close();
    },
    [onHoverOut, close],
  );

  const handleFocus = useCallback(
    (e: unknown) => {
      if (isCallable(onFocus)) onFocus(e);
      if (!ctx.enabled || disabled) return;
      if (!shouldOpenOnFocus()) return;
      clearOpenTimer();
      ctx.setOpen(true);
    },
    [clearOpenTimer, ctx, disabled, onFocus],
  );

  const handleBlur = useCallback(
    (e: unknown) => {
      if (isCallable(onBlur)) onBlur(e);
      close();
    },
    [close, onBlur],
  );

  const handlePress = useCallback(
    (e: unknown) => {
      if (isCallable(onPress)) onPress(e);
      if (!ctx.enabled || disabled) {
        return;
      }
      if (ctx.openOnPress) {
        clearOpenTimer();
        ctx.setOpen(true);
        return;
      }
      close();
    },
    [clearOpenTimer, close, ctx, disabled, onPress],
  );

  const triggerProps = {
    ...props,
    disabled,
    onHoverIn: handleHoverIn,
    onHoverOut: handleHoverOut,
    onFocus: handleFocus,
    onBlur: handleBlur,
    onPress: handlePress,
    ...(isWeb
      ? ({
          // RN Web's hover handling can vary across environments; pointer events are the most reliable.
          onPointerEnter: handleHoverIn,
          onPointerLeave: handleHoverOut,
          onMouseEnter: handleHoverIn,
          onMouseLeave: handleHoverOut,
        } as object)
      : null),
  };

  if (asChild) {
    const child = Children.only(children);
    if (!isValidElement(child)) {
      throw new Error("TooltipTrigger with asChild expects a single React element child");
    }

    const rawProps: unknown = child.props;
    if (typeof rawProps !== "object" || rawProps === null) {
      throw new Error("TooltipTrigger asChild child must have props object");
    }
    const mergedProps: Record<string, unknown> = {
      ...Object.assign({}, rawProps),
      ...triggerProps,
      disabled: Reflect.get(rawProps, "disabled") || disabled,
      onHoverIn: composeEventHandlers(Reflect.get(rawProps, "onHoverIn"), handleHoverIn),
      onHoverOut: composeEventHandlers(Reflect.get(rawProps, "onHoverOut"), handleHoverOut),
      onFocus: composeEventHandlers(Reflect.get(rawProps, "onFocus"), handleFocus),
      onBlur: composeEventHandlers(Reflect.get(rawProps, "onBlur"), handleBlur),
      onPress: composeEventHandlers(Reflect.get(rawProps, "onPress"), handlePress),
      onPointerEnter: composeEventHandlers(Reflect.get(rawProps, "onPointerEnter"), handleHoverIn),
      onPointerLeave: composeEventHandlers(Reflect.get(rawProps, "onPointerLeave"), handleHoverOut),
      onMouseEnter: composeEventHandlers(Reflect.get(rawProps, "onMouseEnter"), handleHoverIn),
      onMouseLeave: composeEventHandlers(Reflect.get(rawProps, "onMouseLeave"), handleHoverOut),
    };

    const existingRefProp = Reflect.get(rawProps, triggerRefProp);
    mergedProps[triggerRefProp] = (node: View) => {
      if (isCallable(existingRefProp)) {
        existingRefProp(node);
      } else if (existingRefProp && typeof existingRefProp === "object") {
        Object.assign(existingRefProp, { current: node });
      }
      Object.assign(ctx.triggerRef, { current: node });
    };

    return cloneElement(child, mergedProps);
  }

  return (
    <Pressable {...triggerProps} ref={ctx.triggerRef} collapsable={false}>
      {children}
    </Pressable>
  );
}

export function TooltipContent({
  children,
  side = "top",
  align = "center",
  offset = 6,
  style,
  testID,
  maxWidth = 280,
}: PropsWithChildren<{
  side?: Side;
  align?: Align;
  offset?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  maxWidth?: number;
}>): ReactElement | null {
  const ctx = useTooltipContext("TooltipContent");
  const bottomSheetInternal = useBottomSheetModalInternal(true);
  const [triggerRect, setTriggerRect] = useState<Rect | null>(null);
  const [contentSize, setContentSize] = useState<{ width: number; height: number } | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!ctx.open || !ctx.enabled || !ctx.triggerRef.current) {
      setTriggerRect(null);
      setContentSize(null);
      setPosition(null);
      return () => {};
    }

    const statusBarHeight = Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;
    let cancelled = false;

    void measureFloatingElement(ctx.triggerRef.current).then((rect) => {
      if (!cancelled) setTriggerRect({ ...rect, y: rect.y + statusBarHeight });
      return undefined;
    });

    return () => {
      cancelled = true;
    };
  }, [ctx.enabled, ctx.open, ctx.triggerRef]);

  useEffect(() => {
    if (!triggerRect || !contentSize) return;
    const { width: screenWidth, height: screenHeight } = Dimensions.get("window");
    const displayArea = { x: 0, y: 0, width: screenWidth, height: screenHeight };
    const result = computeFloatingPosition({
      triggerRect,
      contentSize,
      displayArea,
      side,
      align,
      offset,
    });
    setPosition({ x: result.x, y: result.y });
  }, [triggerRect, contentSize, side, align, offset]);

  const handleLayout = useCallback(
    (event: { nativeEvent: { layout: { width: number; height: number } } }) => {
      const { width, height } = event.nativeEvent.layout;
      setContentSize({ width, height });
    },
    [],
  );

  const frameStyle = useMemo(
    () => [
      {
        position: "absolute" as const,
        top: position?.y ?? -9999,
        left: position?.x ?? -9999,
        maxWidth,
      },
    ],
    [maxWidth, position?.x, position?.y],
  );
  const contentStyle = useMemo(() => [styles.content, style], [style]);

  const handleDismiss = useCallback(() => ctx.setOpen(false), [ctx]);

  if (!ctx.open || !ctx.enabled) return null;

  // On web, avoid React Native's <Modal/> implementation (it uses <dialog> and can
  // steal focus / disrupt hover). Rendering via Portal + position:fixed keeps the
  // exact same positioning math as DropdownMenu, without hover feedback loops.
  if (isWeb) {
    return (
      <Portal hostName={bottomSheetInternal?.hostName}>
        <View pointerEvents="none" style={styles.portalOverlay}>
          <FloatingSurface
            pointerEvents="none"
            entering={FadeIn.duration(80)}
            exiting={FadeOut.duration(80)}
            collapsable={false}
            testID={testID}
            onLayout={handleLayout}
            style={contentStyle}
            frameStyle={frameStyle}
          >
            {children}
          </FloatingSurface>
        </View>
      </Portal>
    );
  }

  return (
    <Modal
      visible={ctx.open}
      transparent
      animationType="none"
      statusBarTranslucent={Platform.OS === "android"}
      onRequestClose={handleDismiss}
    >
      <Pressable style={styles.overlay} onPress={handleDismiss}>
        <FloatingSurface
          pointerEvents="none"
          entering={FadeIn.duration(80)}
          exiting={FadeOut.duration(80)}
          collapsable={false}
          testID={testID}
          onLayout={handleLayout}
          style={contentStyle}
          frameStyle={frameStyle}
        >
          {children}
        </FloatingSurface>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create((theme) => ({
  overlay: { flex: 1 },
  portalOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1000,
  },
  content: {
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.popover,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    ...theme.shadow.md,
    zIndex: 1000,
  },
}));
