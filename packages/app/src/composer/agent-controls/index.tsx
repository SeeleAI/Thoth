import {
  memo,
  forwardRef,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import {
  View,
  Text,
  Pressable,
  Keyboard,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { shallow } from "zustand/shallow";
import { Brain, ListTodo, RefreshCw, Settings2, ShieldCheck, Zap } from "lucide-react-native";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { getProviderIcon } from "@/components/provider-icons";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import {
  buildProviderSelectorProviders,
  buildSelectableProviderSelectorProviders,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import { useAuthorityProjection } from "@/projection/projection-context";
import type { AuthorityProjection } from "@/projection/authority-projection";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { resolveProviderDefinition } from "@/utils/provider-definitions";
import {
  buildFavoriteModelKey,
  mergeProviderPreferences,
  toggleFavoriteModel,
  useFormPreferences,
} from "@/hooks/use-form-preferences";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { RuntimeControls } from "@/composer/agent-controls/runtime-controls";
import { selectProviderModel } from "@/composer/agent-controls/provider-session-config";
import { AgentModeControlView } from "@/composer/agent-controls/mode-control";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type {
  AgentFeature,
  AgentMode,
  AgentModelDefinition,
  AgentProvider,
} from "@thoth/protocol/agent-types";
import type { AgentProviderDefinition } from "@thoth/protocol/provider-manifest";
import type {
  AgentProviderControl,
  ProviderPlanCapability,
  ProviderRunMode,
} from "@thoth/protocol/provider-control";
import {
  getFeatureHighlightColor,
  getFeatureTooltip,
  getAgentControlHintKey,
  formatThinkingOptionLabel,
  resolveAgentModelSelection,
} from "@/composer/agent-controls/utils";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { toErrorMessage } from "@/utils/error-messages";
import { showProviderNoticeToast } from "@/utils/provider-notice-toast";
import { resolveProviderControlDisplayLabel } from "@/composer/agent-controls/provider-display";

interface AgentControlOption {
  id: string;
  label: string;
}

type AgentControlSelector = "provider" | "mode" | "model" | "thinking" | `feature-${string}`;

interface ControlledAgentControlsProps {
  provider: string;
  providerOptions?: AgentControlOption[];
  selectedProviderId?: string;
  onSelectProvider?: (providerId: string) => void;
  modelOptions?: AgentControlOption[];
  selectedModelId?: string;
  onSelectModel?: (modelId: string) => void;
  onSelectProviderAndModel?: (provider: string, modelId: string) => void;
  thinkingOptions?: AgentControlOption[];
  selectedThinkingOptionId?: string;
  onSelectThinkingOption?: (thinkingOptionId: string) => void;
  disabled?: boolean;
  isModelLoading?: boolean;
  modelSelectorProviders?: ProviderSelectorProvider[];
  favoriteKeys?: Set<string>;
  onToggleFavoriteModel?: (provider: string, modelId: string) => void;
  features?: AgentFeature[];
  onSetFeature?: (featureId: string, value: unknown) => void;
  onDropdownClose?: () => void;
  onModelSelectorOpen?: () => void;
  onRetryModelProvider?: (provider: AgentProvider) => void;
  isRetryingModelProvider?: boolean;
  /** Extra elements rendered inline with the agent controls (desktop only). */
  desktopExtras?: ReactNode;
  controlExtras?: ReactNode;
  runtimeControls?: ReactNode;
  providerDefinitions?: AgentProviderDefinition[];
  modeOptions?: AgentMode[];
  selectedModeId?: string | null;
  onSelectMode?: (modeId: string) => void;
  modelSelectorServerId?: string | null;
  isCompactLayout?: boolean;
  providerRunMode?: ProviderRunMode;
  planCapability?: ProviderPlanCapability | null;
  providerControlBusy?: boolean;
  onSelectProviderRunMode?: (runMode: ProviderRunMode) => void;
  onRetryProviderPlanCapability?: () => void;
}

export interface DraftAgentControlsProps {
  providerDefinitions: AgentProviderDefinition[];
  selectedProvider: AgentProvider | null;
  onSelectProvider: (provider: AgentProvider) => void;
  modeOptions: AgentMode[];
  selectedMode: string;
  onSelectMode: (modeId: string) => void;
  models: AgentModelDefinition[];
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
  isModelLoading: boolean;
  modelSelectorProviders: ProviderSelectorProvider[];
  isAllModelsLoading: boolean;
  onSelectProviderAndModel: (provider: AgentProvider, modelId: string) => void;
  thinkingOptions: NonNullable<AgentModelDefinition["thinkingOptions"]>;
  selectedThinkingOptionId: string;
  onSelectThinkingOption: (thinkingOptionId: string) => void;
  features?: AgentFeature[];
  onSetFeature?: (featureId: string, value: unknown) => void;
  onDropdownClose?: () => void;
  onModelSelectorOpen?: () => void;
  onRetryModelProvider?: (provider: AgentProvider) => void;
  isRetryingModelProvider?: boolean;
  disabled?: boolean;
  modelSelectorServerId?: string | null;
  isCompactLayout?: boolean;
  controlExtras?: ReactNode;
  planCapability?: ProviderPlanCapability | null;
  providerRunMode?: ProviderRunMode;
  onSelectProviderRunMode?: (runMode: ProviderRunMode) => void;
}

interface AgentControlsProps {
  agentId: string;
  serverId: string;
  onDropdownClose?: () => void;
  isCompactLayout?: boolean;
  controlExtras?: ReactNode;
}

function findOptionLabel(
  options: AgentControlOption[] | undefined,
  selectedId: string | undefined,
  fallback: string,
) {
  if (!options || options.length === 0) {
    return fallback;
  }
  const selected = options.find((option) => option.id === selectedId);
  return selected?.label ?? fallback;
}

const FEATURE_ICONS: Record<string, typeof Zap> = {
  "list-todo": ListTodo,
  "shield-check": ShieldCheck,
  zap: Zap,
};

function getFeatureIcon(icon?: string) {
  return (icon && FEATURE_ICONS[icon]) || Settings2;
}

function getFeatureIconColor(
  featureId: string,
  enabled: boolean,
  palette: {
    blue: { 400: string };
    green: { 400: string };
    yellow: { 400: string };
  },
  foregroundMuted: string,
): string {
  if (!enabled) {
    return foregroundMuted;
  }

  switch (getFeatureHighlightColor(featureId)) {
    case "blue":
      return palette.blue[400];
    case "green":
      return palette.green[400];
    case "yellow":
      return palette.yellow[400];
    default:
      return foregroundMuted;
  }
}

// Mobile agent controls only — strip namespace prefix so providers like OpenCode
// show "gpt-5.5" instead of "openrouter/gpt-5.5". Full label still appears in
// the model picker.
function shortModelLabel(label: string): string {
  const i = label.lastIndexOf("/");
  return i === -1 ? label : label.slice(i + 1);
}

type ActiveSheet = "provider" | "thinking" | "features" | null;

function resolveHasAnyControl({
  providerOptions,
  canSelectModel,
  thinkingOptions,
  features,
  hasRuntimeControls,
  hasDesktopExtras,
  hasControlExtras,
}: {
  providerOptions: AgentControlOption[] | undefined;
  canSelectModel: boolean;
  thinkingOptions: AgentControlOption[] | undefined;
  features: AgentFeature[] | undefined;
  hasRuntimeControls: boolean;
  hasDesktopExtras: boolean;
  hasControlExtras: boolean;
}) {
  return (
    Boolean(providerOptions?.length) ||
    canSelectModel ||
    Boolean(thinkingOptions?.length) ||
    Boolean(features?.length) ||
    hasRuntimeControls ||
    hasDesktopExtras ||
    hasControlExtras
  );
}

function toComboboxOptions(options: AgentControlOption[] | undefined): ComboboxOption[] {
  return (options ?? []).map((o) => ({ id: o.id, label: o.label }));
}

function toThinkingControlOptions(options: AgentControlOption[] | undefined): AgentControlOption[] {
  return (options ?? []).map((option) => ({
    id: option.id,
    label: formatThinkingOptionLabel(option),
  }));
}

function buildFallbackModelSelectorProviders(
  provider: string,
  modelOptions: AgentControlOption[] | undefined,
): ProviderSelectorProvider[] {
  if (!modelOptions || modelOptions.length === 0) {
    return [];
  }
  return [
    {
      id: provider,
      label: provider,
      modelSelection: {
        kind: "models",
        rows: modelOptions.map((option) => ({
          favoriteKey: buildFavoriteModelKey({ provider, modelId: option.id }),
          provider,
          providerLabel: provider,
          modelId: option.id,
          modelLabel: option.label,
        })),
      },
    },
  ];
}

function makeBadgePressableStyle(
  baseStyle: StyleProp<ViewStyle>,
  disabledStyle: StyleProp<ViewStyle>,
  disabled: boolean,
  isOpen: boolean,
) {
  return ({ pressed, hovered }: PressableStateCallbackType) => [
    baseStyle,
    hovered && styles.modeBadgeHovered,
    (pressed || isOpen) && styles.modeBadgePressed,
    disabled && disabledStyle,
  ];
}

function resolveProviderIcon(provider: string) {
  if (provider.trim().length === 0) {
    return null;
  }
  return getProviderIcon(provider);
}

type AgentControlsSlice = {
  provider: string;
  cwd: string | null;
  runtimeModelId: string | null;
  modeId: string | null;
  availableModes: AgentMode[];
  model: string | null | undefined;
  features: AgentFeature[] | undefined;
  thinkingOptionId: string | null | undefined;
  lastUsage: unknown;
  providerControl: AgentProviderControl;
} | null;

function selectAgentControlsSlice(
  projection: AuthorityProjection,
  agentId: string,
): AgentControlsSlice {
  const currentAgent = projection.agents.get(agentId) ?? null;
  if (!currentAgent) {
    return null;
  }
  return {
    provider: currentAgent.provider,
    cwd: currentAgent.cwd,
    runtimeModelId: currentAgent.runtimeInfo?.model ?? null,
    modeId: currentAgent.currentModeId ?? currentAgent.runtimeInfo?.modeId ?? null,
    availableModes: currentAgent.availableModes ?? [],
    model: currentAgent.model,
    features: currentAgent.features,
    thinkingOptionId: currentAgent.thinkingOptionId ?? currentAgent.runtimeInfo?.thinkingOptionId,
    lastUsage: currentAgent.lastUsage,
    providerControl: currentAgent.providerControl ?? {
      runMode: "default",
      planCapability: currentAgent.planCapability ?? {
        kind: "unavailable",
        reason: "Provider session capability is not loaded.",
      },
      revision: 0,
    },
  };
}

function resolveSnapshotSelectedEntry(
  snapshotEntries: ReturnType<typeof useProvidersSnapshot>["entries"],
  agentProvider: string | undefined,
) {
  if (!snapshotEntries || !agentProvider) {
    return null;
  }
  return snapshotEntries.find((e) => e.provider === agentProvider) ?? null;
}

function buildAgentProviderDefinitions(
  agentProvider: string | undefined,
  snapshotEntries: ReturnType<typeof useProvidersSnapshot>["entries"],
): AgentProviderDefinition[] {
  const definition = agentProvider
    ? resolveProviderDefinition(agentProvider, snapshotEntries)
    : undefined;
  return definition ? [definition] : [];
}

function buildAgentProviderModels(
  agentProvider: string | undefined,
  models: AgentModelDefinition[] | null,
): Map<string, AgentModelDefinition[]> {
  const map = new Map<string, AgentModelDefinition[]>();
  if (agentProvider && models) {
    map.set(agentProvider, models);
  }
  return map;
}

function buildOpenChangeHandler(
  selector: AgentControlSelector,
  setOpenSelector: (next: AgentControlSelector | null) => void,
  onDropdownClose?: () => void,
) {
  return (nextOpen: boolean) => {
    setOpenSelector(nextOpen ? selector : null);
    if (!nextOpen) {
      onDropdownClose?.();
    }
  };
}

const DESKTOP_SEARCH_THRESHOLD = 6;

function ControlledAgentControls({
  provider,
  providerOptions,
  selectedProviderId,
  onSelectProvider,
  modelOptions,
  selectedModelId,
  onSelectModel,
  onSelectProviderAndModel,
  thinkingOptions,
  selectedThinkingOptionId,
  onSelectThinkingOption,
  disabled = false,
  isModelLoading = false,
  modelSelectorProviders,
  favoriteKeys = new Set<string>(),
  onToggleFavoriteModel,
  features,
  onSetFeature,
  onDropdownClose,
  onModelSelectorOpen,
  onRetryModelProvider,
  isRetryingModelProvider = false,
  desktopExtras,
  controlExtras,
  runtimeControls,
  providerDefinitions = [],
  modeOptions = [],
  selectedModeId,
  onSelectMode,
  providerRunMode = "default",
  planCapability = null,
  providerControlBusy = false,
  onSelectProviderRunMode,
  onRetryProviderPlanCapability,
  modelSelectorServerId = null,
  isCompactLayout,
}: ControlledAgentControlsProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const isCompactFormFactor = useIsCompactFormFactor();
  const isCompact = isCompactLayout ?? isCompactFormFactor;
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const [openSelector, setOpenSelector] = useState<AgentControlSelector | null>(null);

  const providerAnchorRef = useRef<View>(null);
  const thinkingAnchorRef = useRef<View>(null);

  const canSelectProvider = Boolean(
    onSelectProvider && providerOptions && providerOptions.length > 0,
  );
  const canSelectModel = Boolean(onSelectModel);
  const canSelectThinking = Boolean(
    onSelectThinkingOption && thinkingOptions && thinkingOptions.length > 0,
  );

  const displayProvider = findOptionLabel(
    providerOptions,
    selectedProviderId,
    t("agentControls.provider.fallback"),
  );
  const displayModel = resolveProviderControlDisplayLabel({
    modelOptions,
    selectedModelId,
    provider,
    providerLabel: displayProvider,
  });
  const formattedThinkingOptions = useMemo(
    () => toThinkingControlOptions(thinkingOptions),
    [thinkingOptions],
  );
  const ProviderIcon = resolveProviderIcon(provider);

  const hasAnyControl = resolveHasAnyControl({
    providerOptions,
    canSelectModel,
    thinkingOptions,
    features,
    hasRuntimeControls: runtimeControls !== null && runtimeControls !== undefined,
    hasDesktopExtras: desktopExtras !== null && desktopExtras !== undefined,
    hasControlExtras: controlExtras !== null && controlExtras !== undefined,
  });

  const modelDisabled = disabled;

  const fallbackModelSelectorProviders = useMemo(
    () => buildFallbackModelSelectorProviders(provider, modelOptions),
    [modelOptions, provider],
  );
  const effectiveModelSelectorProviders = modelSelectorProviders ?? fallbackModelSelectorProviders;
  const comboboxThinkingOptions = useMemo<ComboboxOption[]>(
    () => toComboboxOptions(formattedThinkingOptions),
    [formattedThinkingOptions],
  );

  const renderThinkingOption = useCallback(
    (args: { option: ComboboxOption; selected: boolean; active: boolean; onPress: () => void }) => (
      <ThinkingComboboxOption
        option={args.option}
        selected={args.selected}
        active={args.active}
        onPress={args.onPress}
        iconColor={theme.colors.foreground}
      />
    ),
    [theme.colors.foreground],
  );

  const handleOpenChange = useCallback(
    (selector: AgentControlSelector) =>
      buildOpenChangeHandler(selector, setOpenSelector, onDropdownClose),
    [onDropdownClose],
  );

  const handleProviderPress = useCallback(() => {
    Keyboard.dismiss();
    setActiveSheet("provider");
  }, []);

  const handleThinkingPress = useCallback(() => {
    handleOpenChange("thinking")(openSelector !== "thinking");
  }, [handleOpenChange, openSelector]);

  const handleThinkingOpenChange = useMemo(() => handleOpenChange("thinking"), [handleOpenChange]);

  const handleThinkingSelect = useCallback(
    (id: string) => onSelectThinkingOption?.(id),
    [onSelectThinkingOption],
  );

  const handleCloseSheet = useCallback(() => {
    setActiveSheet(null);
  }, []);

  const handleSelectThinkingAndClose = useCallback(
    (thinkingOptionId: string) => {
      onSelectThinkingOption?.(thinkingOptionId);
      setActiveSheet(null);
    },
    [onSelectThinkingOption],
  );

  const handleSheetModelSelect = useCallback(
    (nextProviderId: string, modelId: string) => {
      selectProviderModel({
        nextProviderId,
        modelId,
        currentProvider: provider,
        onSelectProviderAndModel,
        onSelectProvider,
        onSelectModel,
      });
    },
    [onSelectModel, onSelectProvider, onSelectProviderAndModel, provider],
  );

  if (!hasAnyControl) {
    return null;
  }

  return (
    <View style={styles.container}>
      {isCompact ? (
        canSelectModel || onSelectProviderRunMode ? (
          <Pressable
            onPress={handleProviderPress}
            disabled={disabled}
            style={styles.providerConfigPressable}
            accessibilityRole="button"
            accessibilityLabel={t("agentControls.provider.select")}
            testID="agent-provider-config"
          >
            <View pointerEvents="none" style={styles.prefsButton} testID="agent-controls-model">
              {ProviderIcon ? (
                <ProviderIcon size={theme.iconSize.lg} color={theme.colors.foregroundMuted} />
              ) : null}
              <Text style={styles.prefsButtonPrefix}>Provider</Text>
              <Text style={styles.prefsButtonText} numberOfLines={1}>
                {shortModelLabel(displayModel)}
              </Text>
            </View>
          </Pressable>
        ) : null
      ) : (
        <ProviderConfigTrigger
          ref={providerAnchorRef}
          disabled={disabled || (!canSelectModel && !canSelectProvider && !onSelectProviderRunMode)}
          onPress={handleProviderPress}
          open={activeSheet === "provider"}
          icon={ProviderIcon}
          label={displayModel}
          fallback={selectedModelId ?? provider}
        />
      )}

      {runtimeControls}
      {controlExtras}
      {!isCompact ? desktopExtras : null}

      <ProviderConfigSheet
        visible={activeSheet === "provider"}
        onClose={handleCloseSheet}
        provider={provider}
        modelSelectorProviders={effectiveModelSelectorProviders}
        selectedModelId={selectedModelId}
        onSelectModel={handleSheetModelSelect}
        favoriteKeys={favoriteKeys}
        onToggleFavoriteModel={onToggleFavoriteModel}
        isModelLoading={isModelLoading}
        modelDisabled={modelDisabled}
        onModelSelectorOpen={onModelSelectorOpen}
        onDropdownClose={onDropdownClose}
        onRetryModelProvider={onRetryModelProvider}
        isRetryingModelProvider={isRetryingModelProvider}
        providerDefinitions={providerDefinitions}
        modeOptions={modeOptions}
        selectedModeId={selectedModeId}
        onSelectMode={onSelectMode}
        providerRunMode={providerRunMode}
        planCapability={planCapability}
        providerControlBusy={providerControlBusy}
        onSelectProviderRunMode={onSelectProviderRunMode}
        onRetryProviderPlanCapability={onRetryProviderPlanCapability}
        thinkingOptions={formattedThinkingOptions}
        selectedThinkingOptionId={selectedThinkingOptionId}
        canSelectThinking={canSelectThinking}
        comboboxThinkingOptions={comboboxThinkingOptions}
        thinkingAnchorRef={thinkingAnchorRef}
        handleOpenThinking={handleThinkingPress}
        handleThinkingOpenChange={handleThinkingOpenChange}
        handleThinkingSelect={isCompact ? handleSelectThinkingAndClose : handleThinkingSelect}
        renderThinkingOption={renderThinkingOption}
        features={features}
        onSetFeature={onSetFeature}
        disabled={disabled}
        openSelector={openSelector}
        handleOpenChange={handleOpenChange}
        modelSelectorServerId={modelSelectorServerId}
      />
    </View>
  );
}

const ProviderConfigTrigger = forwardRef<
  View,
  {
    disabled: boolean;
    onPress: () => void;
    open: boolean;
    icon: ReturnType<typeof getProviderIcon> | null;
    label: string;
    fallback: string;
  }
>(function ProviderConfigTrigger(
  { disabled, onPress, open, icon: ProviderIcon, label, fallback },
  ref,
) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const pressableStyle = useMemo(
    () => makeBadgePressableStyle(styles.modeBadge, styles.disabledBadge, disabled, open),
    [disabled, open],
  );
  const displayLabel = label || fallback || t("agentControls.provider.fallback");
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild triggerRefProp="ref">
        <Pressable
          ref={ref}
          disabled={disabled}
          onPress={onPress}
          style={pressableStyle}
          accessibilityRole="button"
          accessibilityLabel={t("agentControls.provider.select")}
          testID="agent-provider-config"
        >
          {ProviderIcon ? (
            <ProviderIcon size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
          ) : (
            <Settings2 size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
          )}
          <Text style={styles.controlPrefix}>Provider</Text>
          <Text style={styles.modeBadgeText} numberOfLines={1}>
            {shortModelLabel(displayLabel)}
          </Text>
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{t(getAgentControlHintKey("model"))}</Text>
      </TooltipContent>
    </Tooltip>
  );
});

function ProviderConfigSheet({
  visible,
  onClose,
  provider,
  modelSelectorProviders,
  selectedModelId,
  onSelectModel,
  favoriteKeys,
  onToggleFavoriteModel,
  isModelLoading,
  modelDisabled,
  onModelSelectorOpen,
  onDropdownClose,
  onRetryModelProvider,
  isRetryingModelProvider,
  providerDefinitions,
  modeOptions,
  selectedModeId,
  onSelectMode,
  providerRunMode = "default",
  planCapability,
  providerControlBusy,
  onSelectProviderRunMode,
  onRetryProviderPlanCapability,
  thinkingOptions,
  selectedThinkingOptionId,
  canSelectThinking,
  comboboxThinkingOptions,
  thinkingAnchorRef,
  handleOpenThinking,
  handleThinkingOpenChange,
  handleThinkingSelect,
  renderThinkingOption,
  features,
  onSetFeature,
  disabled,
  openSelector,
  handleOpenChange,
  modelSelectorServerId,
}: {
  visible: boolean;
  onClose: () => void;
  provider: string;
  modelSelectorProviders: ProviderSelectorProvider[];
  selectedModelId?: string;
  onSelectModel: (providerId: string, modelId: string) => void;
  favoriteKeys: Set<string>;
  onToggleFavoriteModel?: (provider: string, modelId: string) => void;
  isModelLoading: boolean;
  modelDisabled: boolean;
  onModelSelectorOpen?: () => void;
  onDropdownClose?: () => void;
  onRetryModelProvider?: (provider: AgentProvider) => void;
  isRetryingModelProvider: boolean;
  providerDefinitions: AgentProviderDefinition[];
  modeOptions: AgentMode[];
  selectedModeId?: string | null;
  onSelectMode?: (modeId: string) => void;
  providerRunMode: ProviderRunMode;
  planCapability: ProviderPlanCapability | null;
  providerControlBusy: boolean;
  onSelectProviderRunMode?: (runMode: ProviderRunMode) => void;
  onRetryProviderPlanCapability?: () => void;
  thinkingOptions?: AgentControlOption[];
  selectedThinkingOptionId?: string;
  canSelectThinking: boolean;
  comboboxThinkingOptions: ComboboxOption[];
  thinkingAnchorRef: RefObject<View | null>;
  handleOpenThinking: () => void;
  handleThinkingOpenChange: (open: boolean) => void;
  handleThinkingSelect: (thinkingOptionId: string) => void;
  renderThinkingOption: (args: {
    option: ComboboxOption;
    selected: boolean;
    active: boolean;
    onPress: () => void;
  }) => ReactElement;
  features?: AgentFeature[];
  onSetFeature?: (featureId: string, value: unknown) => void;
  disabled: boolean;
  openSelector: AgentControlSelector | null;
  handleOpenChange: (selector: AgentControlSelector) => (nextOpen: boolean) => void;
  modelSelectorServerId: string | null;
}) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const header = useMemo<SheetHeader>(() => ({ title: t("agentControls.provider.select") }), [t]);
  const hasProviderMode = modeOptions.length > 0 && onSelectMode;
  const hasThinking = Boolean(thinkingOptions && thinkingOptions.length > 0);
  const hasProviderFeatures = Boolean(onSelectProviderRunMode || (features && features.length > 0));
  const thinkingPressableStyle = useMemo(
    () =>
      makeBadgePressableStyle(
        styles.modeBadge,
        styles.disabledBadge,
        disabled || !canSelectThinking,
        openSelector === "thinking",
      ),
    [canSelectThinking, disabled, openSelector],
  );
  const displayThinking = findOptionLabel(
    thinkingOptions,
    selectedThinkingOptionId,
    thinkingOptions?.[0]?.label ?? t("agentControls.thinking.unknown"),
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      testID="agent-provider-config-sheet"
    >
      <View style={styles.providerConfigSheetContent}>
        <View style={styles.providerConfigSection}>
          <Text style={styles.sheetSectionLabel}>Provider / Model</Text>
          <CombinedModelSelector
            providers={modelSelectorProviders}
            selectedProvider={provider}
            selectedModel={selectedModelId ?? ""}
            onSelect={onSelectModel}
            favoriteKeys={favoriteKeys}
            onToggleFavorite={onToggleFavoriteModel}
            isLoading={isModelLoading}
            disabled={modelDisabled}
            onOpen={onModelSelectorOpen}
            onClose={onDropdownClose}
            onRetryProvider={onRetryModelProvider}
            isRetryingProvider={isRetryingModelProvider}
            serverId={modelSelectorServerId}
          />
        </View>

        {hasProviderMode ? (
          <View style={styles.providerConfigSection}>
            <Text style={styles.sheetSectionLabel}>Provider Mode / Permissions</Text>
            <AgentModeControlView
              provider={provider}
              providerDefinitions={providerDefinitions}
              modeOptions={modeOptions}
              selectedModeId={selectedModeId}
              onSelectMode={onSelectMode}
              disabled={disabled}
            />
          </View>
        ) : null}

        {hasThinking ? (
          <View style={styles.providerConfigSection}>
            <Text style={styles.sheetSectionLabel}>Thinking / Reasoning</Text>
            <ComboboxTrigger
              ref={thinkingAnchorRef}
              collapsable={false}
              disabled={disabled || !canSelectThinking}
              onPress={handleOpenThinking}
              style={thinkingPressableStyle}
              accessibilityRole="button"
              accessibilityLabel={t("agentControls.thinking.selectWithValue", {
                value: displayThinking,
              })}
              testID="agent-thinking-selector"
            >
              <Brain size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
              <Text style={styles.modeBadgeText}>{displayThinking}</Text>
            </ComboboxTrigger>
            <Combobox
              options={comboboxThinkingOptions}
              value={selectedThinkingOptionId ?? ""}
              onSelect={handleThinkingSelect}
              searchable={comboboxThinkingOptions.length > DESKTOP_SEARCH_THRESHOLD}
              title={t("agentControls.thinking.title")}
              open={openSelector === "thinking"}
              onOpenChange={handleThinkingOpenChange}
              anchorRef={thinkingAnchorRef}
              desktopPlacement="top-start"
              renderOption={renderThinkingOption}
            />
          </View>
        ) : null}

        {hasProviderFeatures ? (
          <View style={styles.providerConfigSection}>
            <Text style={styles.sheetSectionLabel}>Provider Features</Text>
            <View style={styles.providerFeatureList}>
              {onSelectProviderRunMode ? (
                <ProviderPlanFeatureItem
                  runMode={providerRunMode}
                  capability={planCapability}
                  busy={providerControlBusy}
                  onSelectRunMode={onSelectProviderRunMode}
                  onRetryCapability={onRetryProviderPlanCapability}
                />
              ) : null}
              {(features ?? []).map((feature) => (
                <SheetFeatureItem
                  key={`feature-${feature.id}`}
                  feature={feature}
                  disabled={disabled}
                  openSelector={openSelector}
                  handleOpenChange={handleOpenChange}
                  onSetFeature={onSetFeature}
                />
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </AdaptiveModalSheet>
  );
}

function ProviderPlanFeatureItem({
  runMode,
  capability,
  busy,
  onSelectRunMode,
  onRetryCapability,
}: {
  runMode: ProviderRunMode;
  capability: ProviderPlanCapability | null;
  busy: boolean;
  onSelectRunMode: (runMode: ProviderRunMode) => void;
  onRetryCapability?: () => void;
}) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const enabled = runMode === "plan";
  const native = capability?.kind === "native";
  const retryable = !busy && capability?.kind === "unavailable" && Boolean(onRetryCapability);

  const handleToggle = useCallback(() => {
    onSelectRunMode(enabled ? "default" : "plan");
  }, [enabled, onSelectRunMode]);

  const featureRowStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.sheetSelect,
      pressed && styles.sheetSelectPressed,
    ],
    [],
  );

  const icon = (
    <ListTodo
      size={theme.iconSize.md}
      color={enabled ? theme.colors.palette.blue[400] : theme.colors.foregroundMuted}
    />
  );

  if (native && !busy) {
    return (
      <View style={styles.sheetSection}>
        <Pressable
          onPress={handleToggle}
          style={featureRowStyle}
          accessibilityRole="switch"
          accessibilityLabel="Plan"
          accessibilityState={{ checked: enabled }}
          testID="provider-plan-feature"
        >
          {icon}
          <Text style={styles.sheetSelectText}>Plan</Text>
          <Text style={styles.modeBadgeText} testID="provider-plan-feature-status">
            {enabled ? t("agentControls.features.on") : t("agentControls.features.off")}
          </Text>
        </Pressable>
      </View>
    );
  }

  const reason =
    capability?.kind === "unsupported" || capability?.kind === "unavailable"
      ? capability.reason
      : null;

  return (
    <View style={styles.sheetSection}>
      <View
        style={[styles.sheetSelect, !retryable && styles.disabledSheetSelect]}
        accessibilityRole="button"
        accessibilityLabel="Plan"
        accessibilityState={{ disabled: !retryable, busy }}
        testID="provider-plan-feature"
      >
        {icon}
        <Text style={styles.sheetSelectText}>Plan</Text>
        {retryable ? (
          <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
            <TooltipTrigger asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry Plan capability"
                disabled={busy}
                onPress={onRetryCapability}
                style={styles.providerControlRetry}
                testID="provider-plan-retry"
              >
                <RefreshCw size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
              </Pressable>
            </TooltipTrigger>
            <TooltipContent side="top" align="center" offset={8}>
              <Text style={styles.tooltipText}>Retry Plan capability</Text>
            </TooltipContent>
          </Tooltip>
        ) : (
          <Text style={styles.modeBadgeText} testID="provider-plan-feature-status">
            {busy ? "Checking..." : "Unavailable"}
          </Text>
        )}
      </View>
      {reason ? <Text style={styles.providerControlStatus}>{reason}</Text> : null}
    </View>
  );
}

function SheetFeatureItem({
  feature,
  disabled,
  openSelector,
  handleOpenChange,
  onSetFeature,
}: {
  feature: AgentFeature;
  disabled: boolean;
  openSelector: AgentControlSelector | null;
  handleOpenChange: (selector: AgentControlSelector) => (nextOpen: boolean) => void;
  onSetFeature?: (featureId: string, value: unknown) => void;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const featureSelector: AgentControlSelector = `feature-${feature.id}`;

  const handleFeatureOpenChange = useMemo(
    () => handleOpenChange(featureSelector),
    [handleOpenChange, featureSelector],
  );

  const handleTogglePress = useCallback(() => {
    if (feature.type === "toggle") {
      onSetFeature?.(feature.id, !feature.value);
    }
  }, [feature, onSetFeature]);

  const handleSelectOption = useCallback(
    (optionId: string) => {
      onSetFeature?.(feature.id, optionId);
    },
    [feature.id, onSetFeature],
  );

  const togglePressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.sheetSelect,
      pressed && styles.sheetSelectPressed,
      disabled && styles.disabledSheetSelect,
    ],
    [disabled],
  );

  if (feature.type === "toggle") {
    const FeatureIcon = getFeatureIcon(feature.icon);
    return (
      <View style={styles.sheetSection}>
        <Pressable
          disabled={disabled}
          onPress={handleTogglePress}
          style={togglePressableStyle}
          accessibilityRole="button"
          accessibilityLabel={getFeatureTooltip(feature)}
          testID={`agent-feature-${feature.id}`}
        >
          <FeatureIcon
            size={theme.iconSize.md}
            color={getFeatureIconColor(
              feature.id,
              feature.value,
              theme.colors.palette,
              theme.colors.foregroundMuted,
            )}
          />
          <Text style={styles.sheetSelectText}>{feature.label}</Text>
          <Text style={styles.modeBadgeText}>
            {feature.value ? t("agentControls.features.on") : t("agentControls.features.off")}
          </Text>
        </Pressable>
      </View>
    );
  }

  if (feature.type === "select") {
    const selectedOption = feature.options.find((o) => o.id === feature.value);
    return (
      <View style={styles.sheetSection}>
        <DropdownMenu
          open={openSelector === featureSelector}
          onOpenChange={handleFeatureOpenChange}
        >
          <DropdownTrigger
            disabled={disabled}
            style={togglePressableStyle}
            accessibilityRole="button"
            accessibilityLabel={getFeatureTooltip(feature)}
            testID={`agent-feature-${feature.id}`}
          >
            <Text style={styles.sheetSelectText}>{selectedOption?.label ?? feature.label}</Text>
          </DropdownTrigger>
          <DropdownMenuContent side="top" align="start">
            {feature.options.map((option) => (
              <FeatureOptionMenuItem
                key={option.id}
                option={option}
                selected={option.id === feature.value}
                onSelect={handleSelectOption}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </View>
    );
  }

  return null;
}

function FeatureOptionMenuItem({
  option,
  selected,
  onSelect,
}: {
  option: { id: string; label: string };
  selected: boolean;
  onSelect: (optionId: string) => void;
}) {
  const handleSelect = useCallback(() => {
    onSelect(option.id);
  }, [onSelect, option.id]);

  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {option.label}
    </DropdownMenuItem>
  );
}

function ThinkingComboboxOption({
  option,
  selected,
  active,
  onPress,
  iconColor,
}: {
  option: ComboboxOption;
  selected: boolean;
  active: boolean;
  onPress: () => void;
  iconColor: string;
}) {
  const leadingSlot = useMemo(() => <Brain size={16} color={iconColor} />, [iconColor]);
  return (
    <ComboboxItem
      label={option.label}
      selected={selected}
      active={active}
      onPress={onPress}
      leadingSlot={leadingSlot}
    />
  );
}

export const AgentControls = memo(function AgentControls({
  agentId,
  serverId,
  onDropdownClose,
  isCompactLayout,
  controlExtras,
}: AgentControlsProps) {
  const { preferences, updatePreferences } = useFormPreferences();
  const agent = useAuthorityProjection(
    serverId,
    (projection) => selectAgentControlsSlice(projection, agentId),
    shallow,
  );
  const client = useHostRuntimeClient(serverId);
  const toast = useToast();
  const [providerControlBusy, setProviderControlBusy] = useState(false);

  const {
    entries: snapshotEntries,
    isLoading: snapshotIsLoading,
    isRefreshing: snapshotIsRefreshing,
    refresh: refreshSnapshot,
    refetchIfStale: refetchSnapshotIfStale,
  } = useProvidersSnapshot(serverId, { cwd: agent?.cwd });

  const snapshotSelectedEntry = useMemo(
    () => resolveSnapshotSelectedEntry(snapshotEntries, agent?.provider),
    [snapshotEntries, agent?.provider],
  );

  const models = snapshotSelectedEntry?.models ?? null;
  const selectedProviderIsLoading = snapshotSelectedEntry?.status === "loading";

  const agentProviderDefinitions = useMemo(
    () => buildAgentProviderDefinitions(agent?.provider, snapshotEntries),
    [agent?.provider, snapshotEntries],
  );

  const agentProviderModels = useMemo(
    () => buildAgentProviderModels(agent?.provider, models),
    [agent?.provider, models],
  );
  const agentModelSelectorProviders = useMemo(() => {
    if (snapshotSelectedEntry) {
      return buildSelectableProviderSelectorProviders([snapshotSelectedEntry]);
    }
    return buildProviderSelectorProviders({
      providerDefinitions: agentProviderDefinitions,
      modelsByProvider: agentProviderModels,
    });
  }, [agentProviderDefinitions, agentProviderModels, snapshotSelectedEntry]);

  const modelSelection = resolveAgentModelSelection({
    models,
    runtimeModelId: agent?.runtimeModelId,
    configuredModelId: agent?.model,
    explicitThinkingOptionId: agent?.thinkingOptionId,
  });

  const modelOptions = useMemo<AgentControlOption[]>(() => {
    return (models ?? []).map((model) => ({ id: model.id, label: model.label }));
  }, [models]);
  const favoriteKeys = useMemo(
    () =>
      new Set(
        (preferences.favoriteModels ?? []).map((favorite) => buildFavoriteModelKey(favorite)),
      ),
    [preferences.favoriteModels],
  );

  const thinkingOptions = useMemo<AgentControlOption[]>(() => {
    return (modelSelection.thinkingOptions ?? []).map((option) => ({
      id: option.id,
      label: formatThinkingOptionLabel(option),
    }));
  }, [modelSelection.thinkingOptions]);

  const agentProvider = agent?.provider;
  const activeModelId = modelSelection.activeModelId;
  const agentModeId = agent?.modeId;

  const handleSelectModel = useCallback(
    (modelId: string) => {
      if (!client || !agentProvider) {
        return;
      }
      void updatePreferences((current) =>
        mergeProviderPreferences({
          preferences: current,
          provider: agentProvider,
          updates: {
            model: modelId,
          },
        }),
      ).catch((error) => {
        console.warn("[AgentControls] persist model preference failed", error);
      });
      void client.setAgentModel(agentId, modelId).catch((error) => {
        console.warn("[AgentControls] setAgentModel failed", error);
        toast.error(toErrorMessage(error));
      });
    },
    [agentId, agentProvider, client, toast, updatePreferences],
  );

  const handleToggleFavoriteModel = useCallback(
    (provider: string, modelId: string) => {
      void updatePreferences((current) =>
        toggleFavoriteModel({ preferences: current, provider, modelId }),
      ).catch((error) => {
        console.warn("[AgentControls] toggle favorite model failed", error);
      });
    },
    [updatePreferences],
  );

  const handleSelectThinkingOption = useCallback(
    (thinkingOptionId: string) => {
      if (!client || !agentProvider) {
        return;
      }
      if (activeModelId) {
        void updatePreferences((current) =>
          mergeProviderPreferences({
            preferences: current,
            provider: agentProvider,
            updates: {
              model: activeModelId,
              thinkingByModel: {
                [activeModelId]: thinkingOptionId,
              },
            },
          }),
        ).catch((error) => {
          console.warn("[AgentControls] persist thinking preference failed", error);
        });
      }
      void client
        .setAgentThinkingOption(agentId, thinkingOptionId)
        .then((notice) => showProviderNoticeToast(toast, notice))
        .catch((error) => {
          console.warn("[AgentControls] setAgentThinkingOption failed", error);
          toast.error(toErrorMessage(error));
        });
    },
    [activeModelId, agentId, agentProvider, client, toast, updatePreferences],
  );

  const handleSelectProviderMode = useCallback(
    (modeId: string) => {
      if (!client || !agentProvider) {
        return;
      }
      void updatePreferences((current) =>
        mergeProviderPreferences({
          preferences: current,
          provider: agentProvider,
          updates: {
            mode: modeId || undefined,
          },
        }),
      ).catch((error) => {
        console.warn("[AgentControls] persist provider mode preference failed", error);
      });
      void client
        .setAgentMode(agentId, modeId)
        .then((notice) => showProviderNoticeToast(toast, notice))
        .catch((error) => {
          console.warn("[AgentControls] setAgentMode failed", error);
          toast.error(toErrorMessage(error));
        });
    },
    [agentId, agentProvider, client, toast, updatePreferences],
  );

  const handleSetFeature = useCallback(
    (featureId: string, value: unknown) => {
      if (!client || !agentProvider) {
        return;
      }
      void updatePreferences((current) =>
        mergeProviderPreferences({
          preferences: current,
          provider: agentProvider,
          updates: {
            featureValues: {
              [featureId]: value,
            },
          },
        }),
      ).catch((error) => {
        console.warn("[AgentControls] persist feature preference failed", error);
      });
      void client.setAgentFeature(agentId, featureId, value).catch((error) => {
        console.warn("[AgentControls] setAgentFeature failed", error);
        toast.error(toErrorMessage(error));
      });
    },
    [agentId, agentProvider, client, toast, updatePreferences],
  );

  const handleModelSelectorOpen = useCallback(() => {
    refetchSnapshotIfStale(agentProvider);
  }, [agentProvider, refetchSnapshotIfStale]);

  const handleRetryModelProvider = useCallback(
    (provider: AgentProvider) => {
      void refreshSnapshot([provider]);
    },
    [refreshSnapshot],
  );

  const handleSelectProviderRunMode = useCallback(
    (runMode: ProviderRunMode) => {
      if (!client || !agent || providerControlBusy || runMode === agent.providerControl.runMode) {
        return;
      }
      setProviderControlBusy(true);
      void client
        .updateAgentProviderControl({
          agentId,
          runMode,
          expectedRevision: agent.providerControl.revision,
        })
        .catch((error) => toast.error(toErrorMessage(error)))
        .finally(() => setProviderControlBusy(false));
    },
    [agent, agentId, client, providerControlBusy, toast],
  );

  const handleRetryProviderPlanCapability = useCallback(() => {
    if (!client || providerControlBusy) {
      return;
    }
    setProviderControlBusy(true);
    void client
      .getAgentProviderControl(agentId, { refresh: true })
      .catch((error) => toast.error(toErrorMessage(error)))
      .finally(() => setProviderControlBusy(false));
  }, [agentId, client, providerControlBusy, toast]);

  const runtimeControls = useMemo(
    () => <RuntimeControls serverId={serverId} disabled={!client} />,
    [client, serverId],
  );

  if (!agent) {
    return null;
  }

  return (
    <ControlledAgentControls
      provider={agent.provider}
      modelSelectorProviders={agentModelSelectorProviders}
      modelOptions={modelOptions}
      selectedModelId={modelSelection.activeModelId ?? undefined}
      onSelectModel={handleSelectModel}
      favoriteKeys={favoriteKeys}
      onToggleFavoriteModel={handleToggleFavoriteModel}
      thinkingOptions={thinkingOptions}
      selectedThinkingOptionId={modelSelection.selectedThinkingId ?? undefined}
      onSelectThinkingOption={handleSelectThinkingOption}
      features={agent.features}
      onSetFeature={handleSetFeature}
      isModelLoading={snapshotIsLoading || selectedProviderIsLoading}
      onModelSelectorOpen={handleModelSelectorOpen}
      onRetryModelProvider={handleRetryModelProvider}
      isRetryingModelProvider={snapshotIsRefreshing}
      onDropdownClose={onDropdownClose}
      disabled={!client}
      runtimeControls={runtimeControls}
      controlExtras={controlExtras}
      providerDefinitions={agentProviderDefinitions}
      modeOptions={agent.availableModes}
      selectedModeId={agentModeId}
      onSelectMode={handleSelectProviderMode}
      providerRunMode={agent.providerControl.runMode}
      planCapability={agent.providerControl.planCapability}
      providerControlBusy={providerControlBusy}
      onSelectProviderRunMode={handleSelectProviderRunMode}
      onRetryProviderPlanCapability={handleRetryProviderPlanCapability}
      modelSelectorServerId={serverId}
      isCompactLayout={isCompactLayout}
    />
  );
});

export function DraftAgentControls({
  providerDefinitions: _providerDefinitions,
  selectedProvider,
  onSelectProvider: _onSelectProvider,
  modeOptions: _modeOptions,
  selectedMode,
  onSelectMode,
  models,
  selectedModel,
  onSelectModel,
  isModelLoading: _isModelLoading,
  modelSelectorProviders,
  isAllModelsLoading,
  onSelectProviderAndModel,
  thinkingOptions,
  selectedThinkingOptionId,
  onSelectThinkingOption,
  features,
  onSetFeature,
  onDropdownClose,
  onModelSelectorOpen,
  onRetryModelProvider,
  isRetryingModelProvider = false,
  disabled = false,
  modelSelectorServerId = null,
  isCompactLayout,
  controlExtras,
  planCapability = null,
  providerRunMode = "default",
  onSelectProviderRunMode,
}: DraftAgentControlsProps) {
  const { preferences, updatePreferences } = useFormPreferences();
  const isCompactFormFactor = useIsCompactFormFactor();
  const isCompact = isCompactLayout ?? isCompactFormFactor;

  const mappedThinkingOptions = useMemo<AgentControlOption[]>(() => {
    return toThinkingControlOptions(thinkingOptions);
  }, [thinkingOptions]);
  const favoriteKeys = useMemo(
    () =>
      new Set(
        (preferences.favoriteModels ?? []).map((favorite) => buildFavoriteModelKey(favorite)),
      ),
    [preferences.favoriteModels],
  );

  const effectiveSelectedThinkingOption =
    selectedThinkingOptionId || mappedThinkingOptions[0]?.id || undefined;

  const modelOptions = useMemo<AgentControlOption[]>(
    () =>
      models.map((model) => ({
        id: model.id,
        label: model.label,
      })),
    [models],
  );

  const handleToggleFavorite = useCallback(
    (provider: string, modelId: string) => {
      void updatePreferences((current) =>
        toggleFavoriteModel({ preferences: current, provider, modelId }),
      ).catch((error) => {
        console.warn("[DraftAgentControls] toggle favorite model failed", error);
      });
    },
    [updatePreferences],
  );

  const handleDraftProviderAndModelSelect = useCallback(
    (provider: AgentProvider, modelId: string) => {
      onSelectProviderAndModel(provider, modelId);
    },
    [onSelectProviderAndModel],
  );

  const handleDraftModelSelect = useCallback(
    (modelId: string) => {
      onSelectModel(modelId);
    },
    [onSelectModel],
  );

  const handleDraftThinkingSelect = useCallback(
    (thinkingOptionId: string) => {
      onSelectThinkingOption(thinkingOptionId);
    },
    [onSelectThinkingOption],
  );

  const handleDraftModeSelect = useCallback(
    (modeId: string) => {
      onSelectMode(modeId);
    },
    [onSelectMode],
  );

  const handleDraftFeatureSet = useCallback(
    (featureId: string, value: unknown) => {
      onSetFeature?.(featureId, value);
    },
    [onSetFeature],
  );

  const runtimeControls = useMemo(
    () => <RuntimeControls serverId={modelSelectorServerId} disabled={disabled} />,
    [disabled, modelSelectorServerId],
  );

  return (
    <ControlledAgentControls
      provider={selectedProvider ?? ""}
      modelSelectorProviders={modelSelectorProviders}
      modelOptions={modelOptions}
      selectedModelId={selectedModel}
      onSelectModel={handleDraftModelSelect}
      onSelectProviderAndModel={handleDraftProviderAndModelSelect}
      isModelLoading={isAllModelsLoading}
      favoriteKeys={favoriteKeys}
      onToggleFavoriteModel={handleToggleFavorite}
      thinkingOptions={mappedThinkingOptions}
      selectedThinkingOptionId={effectiveSelectedThinkingOption}
      onSelectThinkingOption={handleDraftThinkingSelect}
      features={features}
      onSetFeature={handleDraftFeatureSet}
      onDropdownClose={isCompact ? undefined : onDropdownClose}
      onModelSelectorOpen={onModelSelectorOpen}
      onRetryModelProvider={onRetryModelProvider}
      isRetryingModelProvider={isRetryingModelProvider}
      disabled={disabled}
      runtimeControls={runtimeControls}
      controlExtras={controlExtras}
      providerDefinitions={_providerDefinitions}
      modeOptions={_modeOptions}
      selectedModeId={selectedMode}
      onSelectMode={handleDraftModeSelect}
      providerRunMode={providerRunMode}
      planCapability={planCapability}
      onSelectProviderRunMode={onSelectProviderRunMode}
      modelSelectorServerId={modelSelectorServerId}
      isCompactLayout={isCompactLayout}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    maxWidth: "100%",
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    flexWrap: "wrap",
    gap: theme.spacing[1],
  },
  modeBadge: {
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "transparent",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius["2xl"],
  },
  modeBadgeHovered: {
    backgroundColor: theme.colors.surface2,
  },
  modeBadgePressed: {
    backgroundColor: theme.colors.surface0,
  },
  disabledBadge: {
    opacity: 0.5,
  },
  modeBadgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  controlPrefix: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
  prefsButton: {
    height: 28,
    minWidth: 0,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius["2xl"],
  },
  prefsButtonText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    flexShrink: 1,
  },
  prefsButtonPrefix: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  providerConfigPressable: {
    minWidth: 0,
    flexShrink: 1,
  },
  providerConfigSheetContent: {
    gap: theme.spacing[4],
  },
  providerConfigSection: {
    gap: theme.spacing[2],
  },
  providerControlRetry: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  providerControlStatus: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  providerFeatureList: {
    gap: theme.spacing[2],
  },
  sheetSectionLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
  },
  sheetSection: {
    gap: theme.spacing[2],
  },
  sheetSelect: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.surface2,
    backgroundColor: theme.colors.surface0,
  },
  sheetSelectPressed: {
    backgroundColor: theme.colors.surface2,
  },
  disabledSheetSelect: {
    opacity: 0.5,
  },
  sheetSelectText: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
}));
