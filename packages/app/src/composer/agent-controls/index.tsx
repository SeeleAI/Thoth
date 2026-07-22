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
import { useShallow } from "zustand/shallow";
import { Brain, ListTodo, Settings2, ShieldCheck, Zap } from "lucide-react-native";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { getProviderIcon } from "@/components/provider-icons";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import {
  buildProviderSelectorProviders,
  buildSelectableProviderSelectorProviders,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import { useSessionStore } from "@/stores/session-store";
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
import type { ProviderPlanCapability } from "@thoth/protocol/provider-control";
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
  planCapability: ProviderPlanCapability | null;
} | null;

function selectAgentControlsSlice(
  state: ReturnType<typeof useSessionStore.getState>,
  serverId: string,
  agentId: string,
): AgentControlsSlice {
  const currentAgent = state.sessions[serverId]?.agents?.get(agentId) ?? null;
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
    planCapability: currentAgent.planCapability ?? null,
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
  const _modelAnchorRef = useRef<View>(null);
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
  const displayThinking = findOptionLabel(
    formattedThinkingOptions,
    selectedThinkingOptionId,
    formattedThinkingOptions[0]?.label ?? t("agentControls.thinking.unknown"),
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

  const comboboxProviderOptions = useMemo<ComboboxOption[]>(
    () => toComboboxOptions(providerOptions),
    [providerOptions],
  );
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

  const handleProviderOpenChange = useMemo(() => handleOpenChange("provider"), [handleOpenChange]);
  const handleThinkingOpenChange = useMemo(() => handleOpenChange("thinking"), [handleOpenChange]);

  const handleProviderSelect = useCallback(
    (id: string) => onSelectProvider?.(id),
    [onSelectProvider],
  );
  const handleThinkingSelect = useCallback(
    (id: string) => onSelectThinkingOption?.(id),
    [onSelectThinkingOption],
  );

  const providerPressableStyle = useMemo(
    () =>
      makeBadgePressableStyle(
        styles.modeBadge,
        styles.disabledBadge,
        disabled || !canSelectProvider,
        openSelector === "provider",
      ),
    [canSelectProvider, disabled, openSelector],
  );

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

  const handleOpenSheet = useCallback((sheet: Exclude<ActiveSheet, null>) => {
    Keyboard.dismiss();
    setActiveSheet(sheet);
  }, []);

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
      {!isCompact ? (
        <DesktopAgentControlsContent
          provider={provider}
          providerOptions={providerOptions}
          selectedProviderId={selectedProviderId}
          modelOptions={modelOptions}
          selectedModelId={selectedModelId}
          thinkingOptions={formattedThinkingOptions}
          selectedThinkingOptionId={selectedThinkingOptionId}
          features={features}
          onSetFeature={onSetFeature}
          onToggleFavoriteModel={onToggleFavoriteModel}
          onDropdownClose={onDropdownClose}
          onModelSelectorOpen={onModelSelectorOpen}
          onRetryModelProvider={onRetryModelProvider}
          isRetryingModelProvider={isRetryingModelProvider}
          favoriteKeys={favoriteKeys}
          disabled={disabled}
          isModelLoading={isModelLoading}
          canSelectProvider={canSelectProvider}
          canSelectModel={canSelectModel}
          canSelectThinking={canSelectThinking}
          modelSelectorProviders={effectiveModelSelectorProviders}
          modelDisabled={modelDisabled}
          comboboxProviderOptions={comboboxProviderOptions}
          comboboxThinkingOptions={comboboxThinkingOptions}
          displayModel={displayModel}
          displayThinking={displayThinking}
          openSelector={openSelector}
          providerAnchorRef={providerAnchorRef}
          thinkingAnchorRef={thinkingAnchorRef}
          providerPressableStyle={providerPressableStyle}
          thinkingPressableStyle={thinkingPressableStyle}
          handleThinkingPress={handleThinkingPress}
          handleProviderSelect={handleProviderSelect}
          handleThinkingSelect={handleThinkingSelect}
          handleDesktopModelSelect={handleSheetModelSelect}
          handleProviderOpenChange={handleProviderOpenChange}
          handleThinkingOpenChange={handleThinkingOpenChange}
          handleOpenChange={handleOpenChange}
          renderThinkingOption={renderThinkingOption}
          runtimeControls={runtimeControls}
          extras={desktopExtras}
          controlExtras={controlExtras}
          providerDefinitions={providerDefinitions}
          modeOptions={modeOptions}
          selectedModeId={selectedModeId}
          onSelectMode={onSelectMode}
          activeSheet={activeSheet}
          handleProviderPress={handleProviderPress}
          handleCloseSheet={handleCloseSheet}
          modelSelectorServerId={modelSelectorServerId}
        />
      ) : (
        <SheetAgentControlsContent
          provider={provider}
          selectedModelId={selectedModelId}
          selectedThinkingOptionId={selectedThinkingOptionId}
          features={features}
          onSetFeature={onSetFeature}
          onToggleFavoriteModel={onToggleFavoriteModel}
          onDropdownClose={onDropdownClose}
          onModelSelectorOpen={onModelSelectorOpen}
          onRetryModelProvider={onRetryModelProvider}
          isRetryingModelProvider={isRetryingModelProvider}
          favoriteKeys={favoriteKeys}
          disabled={disabled}
          isModelLoading={isModelLoading}
          canSelectModel={canSelectModel}
          canSelectThinking={canSelectThinking}
          modelSelectorProviders={effectiveModelSelectorProviders}
          modelDisabled={modelDisabled}
          comboboxThinkingOptions={comboboxThinkingOptions}
          openSelector={openSelector}
          ProviderIcon={ProviderIcon}
          displayModel={displayModel}
          activeSheet={activeSheet}
          runtimeControls={runtimeControls}
          controlExtras={controlExtras}
          providerDefinitions={providerDefinitions}
          modeOptions={modeOptions}
          selectedModeId={selectedModeId}
          onSelectMode={onSelectMode}
          handleProviderPress={handleProviderPress}
          handleOpenSheet={handleOpenSheet}
          handleCloseSheet={handleCloseSheet}
          handleSheetModelSelect={handleSheetModelSelect}
          handleSelectThinkingAndClose={handleSelectThinkingAndClose}
          handleOpenChange={handleOpenChange}
          renderThinkingOption={renderThinkingOption}
          modelSelectorServerId={modelSelectorServerId}
        />
      )}
    </View>
  );
}

interface DesktopAgentControlsContentProps {
  provider: string;
  providerOptions?: AgentControlOption[];
  selectedProviderId?: string;
  modelOptions?: AgentControlOption[];
  selectedModelId?: string;
  thinkingOptions?: AgentControlOption[];
  selectedThinkingOptionId?: string;
  features?: AgentFeature[];
  onSetFeature?: (featureId: string, value: unknown) => void;
  onToggleFavoriteModel?: (provider: string, modelId: string) => void;
  onDropdownClose?: () => void;
  onModelSelectorOpen?: () => void;
  onRetryModelProvider?: (provider: AgentProvider) => void;
  isRetryingModelProvider: boolean;
  favoriteKeys: Set<string>;
  disabled: boolean;
  isModelLoading: boolean;
  canSelectProvider: boolean;
  canSelectModel: boolean;
  canSelectThinking: boolean;
  modelSelectorProviders: ProviderSelectorProvider[];
  modelDisabled: boolean;
  comboboxProviderOptions: ComboboxOption[];
  comboboxThinkingOptions: ComboboxOption[];
  displayModel: string;
  displayThinking: string;
  openSelector: AgentControlSelector | null;
  providerAnchorRef: RefObject<View | null>;
  thinkingAnchorRef: RefObject<View | null>;
  providerPressableStyle: (state: PressableStateCallbackType) => StyleProp<ViewStyle>;
  thinkingPressableStyle: (state: PressableStateCallbackType) => StyleProp<ViewStyle>;
  handleThinkingPress: () => void;
  handleProviderSelect: (id: string) => void;
  handleThinkingSelect: (id: string) => void;
  handleDesktopModelSelect: (providerId: string, modelId: string) => void;
  handleProviderOpenChange: (open: boolean) => void;
  handleThinkingOpenChange: (open: boolean) => void;
  handleOpenChange: (selector: AgentControlSelector) => (nextOpen: boolean) => void;
  renderThinkingOption: (args: {
    option: ComboboxOption;
    selected: boolean;
    active: boolean;
    onPress: () => void;
  }) => ReactElement;
  runtimeControls?: ReactNode;
  extras?: ReactNode;
  controlExtras?: ReactNode;
  providerDefinitions: AgentProviderDefinition[];
  modeOptions: AgentMode[];
  selectedModeId?: string | null;
  onSelectMode?: (modeId: string) => void;
  activeSheet: ActiveSheet;
  handleProviderPress: () => void;
  handleCloseSheet: () => void;
  modelSelectorServerId: string | null;
}

const DESKTOP_SEARCH_THRESHOLD = 6;

function DesktopAgentControlsContent(props: DesktopAgentControlsContentProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const {
    provider,
    providerOptions,
    selectedProviderId,
    selectedModelId,
    thinkingOptions,
    selectedThinkingOptionId,
    features,
    onSetFeature,
    onToggleFavoriteModel,
    onDropdownClose,
    onModelSelectorOpen,
    onRetryModelProvider,
    isRetryingModelProvider,
    favoriteKeys,
    disabled,
    isModelLoading,
    canSelectProvider,
    canSelectModel,
    canSelectThinking,
    modelSelectorProviders,
    modelDisabled,
    comboboxProviderOptions,
    comboboxThinkingOptions,
    displayModel,
    displayThinking,
    openSelector,
    providerAnchorRef,
    thinkingAnchorRef,
    providerPressableStyle,
    thinkingPressableStyle,
    handleThinkingPress,
    handleProviderSelect,
    handleThinkingSelect,
    handleDesktopModelSelect,
    handleProviderOpenChange,
    handleThinkingOpenChange,
    handleOpenChange,
    renderThinkingOption,
    runtimeControls,
    extras,
    controlExtras,
    providerDefinitions,
    modeOptions,
    selectedModeId,
    onSelectMode,
    activeSheet,
    handleProviderPress,
    handleCloseSheet,
    modelSelectorServerId,
  } = props;

  return (
    <>
      <ProviderConfigTrigger
        ref={providerAnchorRef}
        disabled={disabled || (!canSelectModel && !canSelectProvider)}
        onPress={handleProviderPress}
        open={activeSheet === "provider"}
        icon={resolveProviderIcon(provider)}
        label={displayModel}
        fallback={selectedModelId ?? provider}
      />

      {runtimeControls}

      {controlExtras}

      {extras}

      <ProviderConfigSheet
        visible={activeSheet === "provider"}
        onClose={handleCloseSheet}
        provider={provider}
        modelSelectorProviders={modelSelectorProviders}
        selectedModelId={selectedModelId}
        onSelectModel={handleDesktopModelSelect}
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
        thinkingOptions={thinkingOptions}
        selectedThinkingOptionId={selectedThinkingOptionId}
        canSelectThinking={canSelectThinking}
        comboboxThinkingOptions={comboboxThinkingOptions}
        thinkingAnchorRef={thinkingAnchorRef}
        handleOpenThinking={handleThinkingPress}
        handleThinkingOpenChange={handleThinkingOpenChange}
        handleThinkingSelect={handleThinkingSelect}
        renderThinkingOption={renderThinkingOption}
        features={features}
        onSetFeature={onSetFeature}
        disabled={disabled}
        openSelector={openSelector}
        handleOpenChange={handleOpenChange}
        modelSelectorServerId={modelSelectorServerId}
      />
    </>
  );
}

interface SheetAgentControlsContentProps {
  provider: string;
  selectedModelId?: string;
  selectedThinkingOptionId?: string;
  features?: AgentFeature[];
  onSetFeature?: (featureId: string, value: unknown) => void;
  onToggleFavoriteModel?: (provider: string, modelId: string) => void;
  onDropdownClose?: () => void;
  onModelSelectorOpen?: () => void;
  onRetryModelProvider?: (provider: AgentProvider) => void;
  isRetryingModelProvider: boolean;
  favoriteKeys: Set<string>;
  disabled: boolean;
  isModelLoading: boolean;
  canSelectModel: boolean;
  canSelectThinking: boolean;
  modelSelectorProviders: ProviderSelectorProvider[];
  modelDisabled: boolean;
  comboboxThinkingOptions: ComboboxOption[];
  openSelector: AgentControlSelector | null;
  ProviderIcon: ReturnType<typeof getProviderIcon> | null;
  displayModel: string;
  activeSheet: ActiveSheet;
  runtimeControls?: ReactNode;
  controlExtras?: ReactNode;
  providerDefinitions: AgentProviderDefinition[];
  modeOptions: AgentMode[];
  selectedModeId?: string | null;
  onSelectMode?: (modeId: string) => void;
  handleProviderPress: () => void;
  handleOpenSheet: (sheet: Exclude<ActiveSheet, null>) => void;
  handleCloseSheet: () => void;
  handleSheetModelSelect: (providerId: string, modelId: string) => void;
  handleSelectThinkingAndClose: (thinkingOptionId: string) => void;
  handleOpenChange: (selector: AgentControlSelector) => (nextOpen: boolean) => void;
  renderThinkingOption: (args: {
    option: ComboboxOption;
    selected: boolean;
    active: boolean;
    onPress: () => void;
  }) => ReactElement;
  modelSelectorServerId: string | null;
}

function SheetAgentControlsContent(props: SheetAgentControlsContentProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const {
    provider,
    selectedModelId,
    selectedThinkingOptionId,
    features,
    onSetFeature,
    onToggleFavoriteModel,
    onDropdownClose,
    onModelSelectorOpen,
    onRetryModelProvider,
    isRetryingModelProvider,
    favoriteKeys,
    disabled,
    isModelLoading,
    canSelectModel,
    canSelectThinking,
    modelSelectorProviders,
    modelDisabled,
    comboboxThinkingOptions,
    openSelector,
    ProviderIcon,
    displayModel,
    activeSheet,
    runtimeControls,
    controlExtras,
    providerDefinitions,
    modeOptions,
    selectedModeId,
    onSelectMode,
    handleProviderPress,
    handleOpenSheet,
    handleCloseSheet,
    handleSheetModelSelect,
    handleSelectThinkingAndClose,
    handleOpenChange,
    renderThinkingOption,
    modelSelectorServerId,
  } = props;

  const thinkingAnchorRef = useRef<View | null>(null);

  const hasThinking = comboboxThinkingOptions.length > 0;
  const hasFeatures = Boolean(features && features.length > 0);
  const featuresSheetHeader = useMemo<SheetHeader>(
    () => ({ title: t("agentControls.features.title") }),
    [t],
  );

  const handleOpenThinking = useCallback(
    () => handleOpenChange("thinking")(openSelector !== "thinking"),
    [handleOpenChange, openSelector],
  );
  const handleThinkingOpenChange = useMemo(() => handleOpenChange("thinking"), [handleOpenChange]);

  const renderModelTrigger = useCallback(
    ({
      selectedModelLabel,
    }: {
      selectedModelLabel: string;
      onPress: () => void;
      disabled: boolean;
      isOpen: boolean;
    }) => (
      <View pointerEvents="none" style={styles.prefsButton} testID="agent-controls-model">
        {ProviderIcon ? (
          <ProviderIcon size={theme.iconSize.lg} color={theme.colors.foregroundMuted} />
        ) : null}
        <Text style={styles.prefsButtonPrefix}>Provider</Text>
        <Text style={styles.prefsButtonText} numberOfLines={1}>
          {shortModelLabel(selectedModelLabel)}
        </Text>
      </View>
    ),
    [ProviderIcon, theme.iconSize.lg, theme.colors.foregroundMuted],
  );

  const thinkingButtonStyle = makeBadgePressableStyle(
    styles.modeIconBadge,
    styles.disabledBadge,
    disabled || !canSelectThinking,
    activeSheet === "thinking",
  );
  const featuresButtonStyle = makeBadgePressableStyle(
    styles.modeIconBadge,
    styles.disabledBadge,
    disabled,
    activeSheet === "features",
  );

  return (
    <>
      {canSelectModel ? (
        <Pressable
          onPress={handleProviderPress}
          disabled={disabled || !canSelectModel}
          style={styles.providerConfigPressable}
          accessibilityRole="button"
          accessibilityLabel={t("agentControls.provider.select")}
          testID="agent-provider-config"
        >
          {renderModelTrigger({
            selectedModelLabel: displayModel,
            onPress: handleProviderPress,
            disabled: disabled || !canSelectModel,
            isOpen: activeSheet === "provider",
          })}
        </Pressable>
      ) : null}

      {runtimeControls}

      {controlExtras}

      <ProviderConfigSheet
        visible={activeSheet === "provider"}
        onClose={handleCloseSheet}
        provider={provider}
        modelSelectorProviders={modelSelectorProviders}
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
        thinkingOptions={hasThinking ? comboboxThinkingOptions : []}
        selectedThinkingOptionId={selectedThinkingOptionId}
        canSelectThinking={canSelectThinking}
        comboboxThinkingOptions={comboboxThinkingOptions}
        thinkingAnchorRef={thinkingAnchorRef}
        handleOpenThinking={handleOpenThinking}
        handleThinkingOpenChange={handleThinkingOpenChange}
        handleThinkingSelect={handleSelectThinkingAndClose}
        renderThinkingOption={renderThinkingOption}
        features={hasFeatures ? features : undefined}
        onSetFeature={onSetFeature}
        disabled={disabled}
        openSelector={openSelector}
        handleOpenChange={handleOpenChange}
        modelSelectorServerId={modelSelectorServerId}
      />
    </>
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
  const hasFeatures = Boolean(features && features.length > 0);
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

        {hasFeatures ? (
          <View style={styles.providerConfigSection}>
            <Text style={styles.sheetSectionLabel}>Provider Features</Text>
            <View style={styles.providerFeatureList}>
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

function DesktopFeatureItem({
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
    ({ pressed, hovered }: PressableStateCallbackType) => [
      styles.modeIconBadge,
      hovered && styles.modeBadgeHovered,
      pressed && styles.modeBadgePressed,
      disabled && styles.disabledBadge,
    ],
    [disabled],
  );

  const selectPressableStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType) => [
      styles.modeBadge,
      hovered && styles.modeBadgeHovered,
      (pressed || openSelector === featureSelector) && styles.modeBadgePressed,
      disabled && styles.disabledBadge,
    ],
    [disabled, openSelector, featureSelector],
  );

  if (feature.type === "toggle") {
    const FeatureIcon = getFeatureIcon(feature.icon);
    return (
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild triggerRefProp="ref">
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
          </Pressable>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>{getFeatureTooltip(feature)}</Text>
        </TooltipContent>
      </Tooltip>
    );
  }

  if (feature.type === "select") {
    const FeatureIcon = getFeatureIcon(feature.icon);
    const selectedOption = feature.options.find((o) => o.id === feature.value);
    return (
      <DropdownMenu open={openSelector === featureSelector} onOpenChange={handleFeatureOpenChange}>
        <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild triggerRefProp="ref">
            <DropdownTrigger
              disabled={disabled}
              style={selectPressableStyle}
              accessibilityRole="button"
              accessibilityLabel={getFeatureTooltip(feature)}
              testID={`agent-feature-${feature.id}`}
            >
              <FeatureIcon size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
              <Text style={styles.modeBadgeText}>{selectedOption?.label ?? feature.label}</Text>
            </DropdownTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" align="center" offset={8}>
            <Text style={styles.tooltipText}>{getFeatureTooltip(feature)}</Text>
          </TooltipContent>
        </Tooltip>
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
    );
  }

  return null;
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
  const agent = useSessionStore(
    useShallow((state) => selectAgentControlsSlice(state, serverId, agentId)),
  );
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const toast = useToast();

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

  const runtimeControls = useMemo(
    () => (
      <RuntimeControls
        serverId={serverId}
        disabled={!client}
        planCapability={agent?.planCapability ?? snapshotSelectedEntry?.planCapability ?? null}
      />
    ),
    [agent?.planCapability, client, snapshotSelectedEntry?.planCapability, serverId],
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
    () => (
      <RuntimeControls
        serverId={modelSelectorServerId}
        disabled={disabled}
        planCapability={planCapability}
      />
    ),
    [disabled, modelSelectorServerId, planCapability],
  );

  if (!isCompact) {
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
        onDropdownClose={onDropdownClose}
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
        modelSelectorServerId={modelSelectorServerId}
        isCompactLayout={isCompactLayout}
      />
    );
  }

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
  modeIconBadge: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    borderRadius: theme.borderRadius.full,
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
  controlWithLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
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
