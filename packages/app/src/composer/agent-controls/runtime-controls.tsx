import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Animated,
  Easing,
  Text,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ChevronLeft, ChevronRight, GitBranch, SearchCheck, Sparkles } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useToast } from "@/contexts/toast-context";
import { toErrorMessage } from "@/utils/error-messages";
import { isWeb } from "@/constants/platform";
import { Switch } from "@/components/ui/switch";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import {
  isThothModeEnabled,
  resolveThothClarifyStrength,
  resolveThothLoopStrength,
  type ThothClarifyStrength,
} from "@/composer/agent-controls/thoth-mode";
import type {
  ThothRuntimeLoopStrength,
  ThothRuntimeMode,
} from "@thoth/protocol/thoth-runtime-contract";

type ClarifyStrength = ThothClarifyStrength;
type LoopStrength = Exclude<ThothRuntimeLoopStrength, "auto">;

const CLARIFY_OPTIONS: Array<{ id: ClarifyStrength; label: string }> = [
  { id: "light", label: "Light" },
  { id: "balanced", label: "Balanced" },
  { id: "dive", label: "Dive" },
];

const DEFAULT_LOOP_STRENGTH: LoopStrength = "one_plan_one_do";

const LOOP_STRENGTH_OPTIONS: Array<{ id: LoopStrength; label: string }> = [
  { id: "one_plan_one_do", label: "Single" },
  { id: "light", label: "Light" },
  { id: "balanced", label: "Balanced" },
  { id: "run_until_stopped", label: "Infinite" },
];

const WEB_LASER_KEYFRAME_ID = "thoth-loop-infinite-laser-keyframes";
const WEB_LASER_ANIMATION_NAME = "thoth-loop-infinite-laser";
const WEB_DIVE_TEXT_KEYFRAME_ID = "thoth-clarify-dive-text-keyframes";
const WEB_DIVE_TEXT_ANIMATION_NAME = "thoth-clarify-dive-text";
const WEB_LASER_KEYFRAME_CSS = `
  @keyframes ${WEB_LASER_ANIMATION_NAME} {
    0% { background-position: 0% 50%; filter: saturate(1); }
    50% { background-position: 100% 50%; filter: saturate(1.35); }
    100% { background-position: 0% 50%; filter: saturate(1); }
  }
`;
const WEB_DIVE_TEXT_KEYFRAME_CSS = `
  @keyframes ${WEB_DIVE_TEXT_ANIMATION_NAME} {
    0%, 100% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
  }
  @media (prefers-reduced-motion: reduce) {
    [data-testid="thoth-clarify-dive-label"] {
      animation: none !important;
      background-position: 50% 50% !important;
    }
  }
`;

type WebGradientTextStyle = TextStyle & {
  backgroundImage: string;
  backgroundSize: string;
  backgroundClip: string;
  WebkitBackgroundClip: string;
  WebkitTextFillColor: string;
  animation: string;
  textShadow: string;
};

const DIVE_AZURE_TEXT_WEB_STYLE = inlineUnistylesStyle<WebGradientTextStyle>({
  color: "transparent",
  backgroundImage: "linear-gradient(90deg, #0369a1, #0ea5e9, #67e8f9, #2563eb, #0369a1)",
  backgroundSize: "260% 100%",
  backgroundClip: "text",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
  animation: `${WEB_DIVE_TEXT_ANIMATION_NAME} 3.2s ease-in-out infinite`,
  textShadow: "0 0 5px rgba(14, 165, 233, 0.18)",
});

const LASER_TEXT_WEB_STYLE = inlineUnistylesStyle<WebGradientTextStyle>({
  color: "transparent",
  backgroundImage: "linear-gradient(90deg, #38bdf8, #a78bfa, #f472b6, #facc15, #38bdf8)",
  backgroundSize: "240% 100%",
  backgroundClip: "text",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
  animation: `${WEB_LASER_ANIMATION_NAME} 2.4s linear infinite`,
  textShadow: "0 0 10px rgba(167, 139, 250, 0.45)",
});

let webLaserKeyframesRegistered = false;
let webDiveTextKeyframesRegistered = false;

interface RuntimeControlsProps {
  serverId: string | null;
  disabled?: boolean;
}

function getClarifyLabel(value: ClarifyStrength): string {
  return CLARIFY_OPTIONS.find((option) => option.id === value)?.label ?? "Light";
}

function normalizeLoopStrength(value: unknown): LoopStrength {
  const normalized = resolveThothLoopStrength(value);
  return normalized === "auto" ? DEFAULT_LOOP_STRENGTH : normalized;
}

function getLoopStrengthLabel(value: LoopStrength): string {
  return LOOP_STRENGTH_OPTIONS.find((option) => option.id === value)?.label ?? "Single";
}

function getLoopControlLabel(mode: ThothRuntimeMode, loopStrength: LoopStrength): string {
  if (mode === "quick") {
    return "Quick";
  }
  return getLoopStrengthLabel(loopStrength);
}

function isInfiniteLoopLabel(mode: ThothRuntimeMode, loopStrength: LoopStrength): boolean {
  return mode === "loop" && loopStrength === "run_until_stopped";
}

function ensureWebLaserKeyframes() {
  if (!isWeb || typeof document === "undefined") {
    return;
  }
  const existing = document.getElementById(WEB_LASER_KEYFRAME_ID);
  if (existing) {
    if (existing.textContent !== WEB_LASER_KEYFRAME_CSS) {
      existing.textContent = WEB_LASER_KEYFRAME_CSS;
    }
    webLaserKeyframesRegistered = true;
    return;
  }
  if (webLaserKeyframesRegistered) {
    return;
  }
  const styleElement = document.createElement("style");
  styleElement.id = WEB_LASER_KEYFRAME_ID;
  styleElement.textContent = WEB_LASER_KEYFRAME_CSS;
  document.head.appendChild(styleElement);
  webLaserKeyframesRegistered = true;
}

function ensureWebDiveTextKeyframes() {
  if (!isWeb || typeof document === "undefined") {
    return;
  }
  const existing = document.getElementById(WEB_DIVE_TEXT_KEYFRAME_ID);
  if (existing) {
    if (existing.textContent !== WEB_DIVE_TEXT_KEYFRAME_CSS) {
      existing.textContent = WEB_DIVE_TEXT_KEYFRAME_CSS;
    }
    webDiveTextKeyframesRegistered = true;
    return;
  }
  if (webDiveTextKeyframesRegistered) {
    return;
  }
  const styleElement = document.createElement("style");
  styleElement.id = WEB_DIVE_TEXT_KEYFRAME_ID;
  styleElement.textContent = WEB_DIVE_TEXT_KEYFRAME_CSS;
  document.head.appendChild(styleElement);
  webDiveTextKeyframesRegistered = true;
}

function makeChipStyle(
  disabled: boolean,
  open: boolean,
): (state: PressableStateCallbackType) => StyleProp<ViewStyle> {
  return ({ pressed, hovered }) => [
    styles.chip,
    hovered && styles.chipHovered,
    (pressed || open) && styles.chipPressed,
    disabled && styles.chipDisabled,
  ];
}

export const RuntimeControls = memo(function RuntimeControls({
  serverId,
  disabled = false,
}: RuntimeControlsProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const toast = useToast();
  const { config, patchConfig } = useDaemonConfig(serverId);

  const thothEnabled = isThothModeEnabled(config?.thoth);
  const clarify = resolveThothClarifyStrength(config?.thoth.clarifyStrength);
  const mode = (config?.thoth.mode ?? "quick") as ThothRuntimeMode;
  const loopStrength = normalizeLoopStrength(config?.thoth.loopStrength);
  const controlDisabled = disabled || !serverId;
  const persistClarify = useCallback(
    async (clarifyStrength: ClarifyStrength) => {
      try {
        await patchConfig({ thoth: { clarifyStrength } });
      } catch (error) {
        toast.error(toErrorMessage(error));
      }
    },
    [patchConfig, toast],
  );

  const persistThothEnabled = useCallback(
    async (enabled: boolean) => {
      try {
        await patchConfig({
          thoth: enabled
            ? {
                enabled: true,
                clarifyStrength: resolveThothClarifyStrength(config?.thoth.clarifyStrength),
              }
            : { enabled: false },
        });
      } catch (error) {
        toast.error(toErrorMessage(error));
      }
    },
    [config?.thoth.clarifyStrength, patchConfig, toast],
  );

  const persistQuickMode = useCallback(async () => {
    try {
      await patchConfig({ thoth: { mode: "quick" } });
    } catch (error) {
      toast.error(toErrorMessage(error));
    }
  }, [patchConfig, toast]);

  const persistLoopStrength = useCallback(
    async (nextLoopStrength: LoopStrength) => {
      try {
        await patchConfig({
          thoth: { mode: "loop", loopStrength: nextLoopStrength },
        });
      } catch (error) {
        toast.error(toErrorMessage(error));
      }
    },
    [patchConfig, toast],
  );

  const clarifyLabel = getClarifyLabel(clarify);
  const loopLabel = getLoopControlLabel(mode, loopStrength);
  const loopLabelNode = isInfiniteLoopLabel(mode, loopStrength) ? (
    <LoopInfiniteLabel style={styles.chipLabel}>{loopLabel}</LoopInfiniteLabel>
  ) : (
    loopLabel
  );

  const clarifyTrigger = useMemo(
    () => (
      <RuntimeControlTrigger
        icon={<SearchCheck size={theme.iconSize.md} color={theme.colors.foregroundMuted} />}
        prefix="Clarify"
        label={clarifyLabel}
        disabled={controlDisabled}
        accessibilityLabel={t("agentControls.runtime.clarify.selectWithValue", {
          value: clarifyLabel,
        })}
        testID="thoth-clarify-control"
      />
    ),
    [clarifyLabel, controlDisabled, t, theme.colors.foregroundMuted, theme.iconSize.md],
  );

  const modeTrigger = useMemo(
    () => (
      <RuntimeControlTrigger
        icon={<GitBranch size={theme.iconSize.md} color={theme.colors.foregroundMuted} />}
        prefix="Loop"
        label={loopLabelNode}
        disabled={controlDisabled}
        accessibilityLabel={t("agentControls.runtime.mode.selectWithValue", { value: loopLabel })}
        testID="thoth-mode-control"
      />
    ),
    [controlDisabled, loopLabel, loopLabelNode, t, theme.colors.foregroundMuted, theme.iconSize.md],
  );

  return (
    <View style={styles.controls}>
      <View style={[styles.thothSwitch, controlDisabled && styles.chipDisabled]}>
        <Sparkles
          size={theme.iconSize.md}
          color={thothEnabled ? theme.colors.accent : theme.colors.foregroundMuted}
        />
        <Text style={[styles.thothLabel, thothEnabled && styles.thothLabelEnabled]}>Thoth</Text>
        <Switch
          value={thothEnabled}
          onValueChange={persistThothEnabled}
          disabled={controlDisabled}
          accessibilityLabel={t("agentControls.runtime.thoth.switch")}
          testID="thoth-enabled-switch"
        />
      </View>
      {thothEnabled ? (
        <>
          <LoopControlMenu
            trigger={modeTrigger}
            tooltip={t("agentControls.runtime.mode.tooltip")}
            mode={mode}
            loopStrength={loopStrength}
            disabled={controlDisabled}
            onSelectQuick={persistQuickMode}
            onSelectLoopStrength={persistLoopStrength}
            testID="thoth-mode-menu"
          />
          <RuntimeControlMenu
            trigger={clarifyTrigger}
            tooltip={t("agentControls.runtime.clarify.tooltip")}
            options={CLARIFY_OPTIONS}
            selected={clarify}
            disabled={controlDisabled}
            onSelect={persistClarify}
            renderOptionLabel={(option) =>
              option.id === "dive" ? <DiveAzureLabel>{option.label}</DiveAzureLabel> : option.label
            }
            testID="thoth-clarify-menu"
          />
        </>
      ) : null}
    </View>
  );
});

const RuntimeControlTrigger = forwardRef<
  View,
  {
    icon: ReactElement;
    prefix: string;
    label: ReactNode;
    disabled: boolean;
    accessibilityLabel: string;
    testID: string;
  }
>(function RuntimeControlTrigger(
  { icon, prefix, label, disabled, accessibilityLabel, testID },
  ref,
) {
  return (
    <DropdownTrigger
      triggerRef={ref}
      disabled={disabled}
      style={makeChipStyle(disabled, false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {icon}
      <Text style={styles.chipPrefix}>{prefix}</Text>
      {typeof label === "string" ? <Text style={styles.chipLabel}>{label}</Text> : label}
    </DropdownTrigger>
  );
});

function LoopControlMenu({
  trigger,
  tooltip,
  mode,
  loopStrength,
  disabled,
  onSelectQuick,
  onSelectLoopStrength,
  testID,
}: {
  trigger: ReactElement;
  tooltip: string;
  mode: ThothRuntimeMode;
  loopStrength: LoopStrength;
  disabled: boolean;
  onSelectQuick: () => void | Promise<void>;
  onSelectLoopStrength: (value: LoopStrength) => void | Promise<void>;
  testID: string;
}) {
  const { theme } = useUnistyles();
  const [panel, setPanel] = useState<"root" | "loop-strength">("root");
  const [open, setOpen] = useState(false);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setPanel("root");
    }
  }, []);

  const handleSelectQuick = useCallback(() => {
    if (disabled || mode === "quick") return;
    void onSelectQuick();
  }, [disabled, mode, onSelectQuick]);

  const handleOpenLoopStrength = useCallback(() => {
    if (disabled) return;
    setPanel("loop-strength");
  }, [disabled]);

  const handleBack = useCallback(() => {
    setPanel("root");
  }, []);

  const handleSelectStrength = useCallback(
    (id: LoopStrength) => {
      if (disabled || (mode === "loop" && id === loopStrength)) return;
      void onSelectLoopStrength(id);
    },
    [disabled, loopStrength, mode, onSelectLoopStrength],
  );

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild triggerRefProp="ref">
          {trigger}
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>{tooltip}</Text>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="start" width={220} testID={testID}>
        {panel === "root" ? (
          <>
            <DropdownMenuItem
              selected={mode === "quick"}
              onSelect={handleSelectQuick}
              disabled={disabled}
              testID={`${testID}-quick`}
            >
              Quick (Live)
            </DropdownMenuItem>
            <DropdownMenuItem
              selected={mode === "loop"}
              onSelect={handleOpenLoopStrength}
              disabled={disabled}
              closeOnSelect={false}
              trailing={
                <ChevronRight size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
              }
              testID={`${testID}-loop`}
            >
              Loop (Async)
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem
              onSelect={handleBack}
              disabled={disabled}
              closeOnSelect={false}
              leading={
                <ChevronLeft size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
              }
              testID={`${testID}-back`}
            >
              Loop
            </DropdownMenuItem>
            <DropdownMenuLabel>Strength</DropdownMenuLabel>
            {LOOP_STRENGTH_OPTIONS.map((option) => (
              <DropdownMenuItem
                key={option.id}
                selected={mode === "loop" && option.id === loopStrength}
                onSelect={() => handleSelectStrength(option.id)}
                disabled={disabled}
                testID={`${testID}-loop-${option.id}`}
              >
                {option.id === "run_until_stopped" ? (
                  <LoopInfiniteLabel>Infinite</LoopInfiniteLabel>
                ) : (
                  option.label
                )}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LoopInfiniteLabel({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    ensureWebLaserKeyframes();
    if (isWeb) {
      return undefined;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  const nativeColor = pulse.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ["#38bdf8", "#f472b6", "#a78bfa"],
  });

  const animatedStyle = isWeb
    ? LASER_TEXT_WEB_STYLE
    : {
        color: nativeColor,
        textShadowColor: "#a78bfa",
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 7,
      };

  return (
    <Animated.Text
      accessibilityLabel="Loop Infinite"
      numberOfLines={1}
      style={[styles.laserText, style, animatedStyle]}
    >
      {children}
    </Animated.Text>
  );
}

function DiveAzureLabel({ children }: { children: ReactNode }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    ensureWebDiveTextKeyframes();
    if (isWeb) {
      return undefined;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  const nativeColor = pulse.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ["#0284c7", "#22d3ee", "#2563eb"],
  });

  const animatedStyle = isWeb ? DIVE_AZURE_TEXT_WEB_STYLE : { color: nativeColor };

  return (
    <Animated.Text
      accessibilityLabel="Clarify Dive"
      numberOfLines={1}
      testID="thoth-clarify-dive-label"
      style={[styles.diveAzureText, animatedStyle]}
    >
      {children}
    </Animated.Text>
  );
}

function RuntimeControlMenu<T extends string>({
  trigger,
  tooltip,
  options,
  selected,
  disabled,
  onSelect,
  renderOptionLabel,
  testID,
}: {
  trigger: ReactElement;
  tooltip: string;
  options: Array<{ id: T; label: string }>;
  selected: T;
  disabled: boolean;
  onSelect: (value: T) => void | Promise<void>;
  renderOptionLabel?: (option: { id: T; label: string }) => ReactNode;
  testID: string;
}) {
  const handleSelect = useCallback(
    (id: T) => {
      if (disabled || id === selected) return;
      void onSelect(id);
    },
    [disabled, onSelect, selected],
  );

  return (
    <DropdownMenu>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild triggerRefProp="ref">
          {trigger}
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>{tooltip}</Text>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="start" width={180} testID={testID}>
        {options.map((option) => (
          <DropdownMenuItem
            key={option.id}
            selected={option.id === selected}
            onSelect={() => handleSelect(option.id)}
            disabled={disabled}
            testID={`${testID}-${option.id}`}
          >
            {renderOptionLabel?.(option) ?? option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  thothSwitch: {
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
  },
  thothLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  thothLabelEnabled: {
    color: theme.colors.foreground,
  },
  chip: {
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "transparent",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius["2xl"],
  },
  chipHovered: {
    backgroundColor: theme.colors.surface2,
  },
  chipPressed: {
    backgroundColor: theme.colors.surface0,
  },
  chipDisabled: {
    opacity: 0.5,
  },
  chipLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  diveAzureText: {
    color: "#0284c7",
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  laserText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  chipPrefix: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
}));
