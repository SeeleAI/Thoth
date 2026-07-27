import {
  View,
  Text,
  TextInput,
  Pressable,
  Platform,
  ActivityIndicator,
  useWindowDimensions,
  NativeSyntheticEvent,
  TextInputContentSizeChangeEventData,
  TextInputKeyPressEventData,
  TextInputSelectionChangeEventData,
} from "react-native";
import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useMemo,
  forwardRef,
} from "react";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { ArrowUp, CornerDownLeft, Plus } from "lucide-react-native";
import type { DaemonClient } from "@thoth/client/internal/daemon-client";
import {
  collectImageFilesFromClipboardData,
  filesToImageAttachments,
} from "@/utils/image-attachments-from-files";
import type { ComposerAttachment } from "@/attachments/types";
import type { ImageAttachment, MessagePayload } from "@/composer/types";
import { focusWithRetries } from "@/utils/web-focus";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Shortcut } from "@/components/ui/shortcut";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { useDismissKeyboardOnOpen } from "@/components/ui/keyboard-dismiss";
import { useWebElementScrollbar } from "@/components/use-web-scrollbar";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useIosHardwareKeyboardSubmit } from "@/hooks/use-ios-hardware-keyboard-submit";
import { formatShortcut, type ShortcutKey } from "@/utils/format-shortcut";
import { getShortcutOs } from "@/utils/shortcut-platform";
import type { MessageInputKeyboardActionKind } from "@/keyboard/actions";
import { isImeComposingKeyboardEvent } from "@/utils/keyboard-ime";
import { isWeb } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useComposerHeightMirror } from "./height-mirror";
import { resolveSendTooltipLabel, resolveSubmitAccessibilityLabel } from "./labels";
import { runAlternateSendAction, runDefaultSendAction } from "./state";

const DEFAULT_SEND_KEYS: ShortcutKey[][] = [["Enter"]];

export interface AttachmentMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  icon?: React.ReactElement | null;
}

export interface MessageInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: (payload: MessagePayload) => void;
  /** When true, the submit button is enabled even without text or images (e.g. external attachment selected). */
  hasExternalContent?: boolean;
  /** When true, the submit button stays visible and can submit even with no content. */
  allowEmptySubmit?: boolean;
  /** Optional accessibility label for the primary submit button. */
  submitButtonAccessibilityLabel?: string;
  /** Optional testID for the primary submit button. */
  submitButtonTestID?: string;
  submitIcon?: "arrow" | "return";
  isSubmitDisabled?: boolean;
  isSubmitLoading?: boolean;
  /** When true, keep the grown input height after submit (text is preserved, not cleared). */
  preserveHeightOnSubmit?: boolean;
  attachments: ComposerAttachment[];
  cwd: string;
  attachmentMenuItems: AttachmentMenuItem[];
  onAttachButtonRef?: (node: View | null) => void;
  onAddImages?: (images: ImageAttachment[]) => void;
  client: DaemonClient | null;
  placeholder?: string;
  autoFocus?: boolean;
  autoFocusKey?: string;
  disabled?: boolean;
  /** True when this composer's pane is focused. Used to gate global hotkeys. */
  isPaneFocused?: boolean;
  /** Content to render on the left side of the composer toolbar (e.g., AgentControls) */
  leftContent?: React.ReactNode;
  /** Content to render before the send action (e.g., context meter or cancel button). */
  rightContent?: React.ReactNode;
  /** When true and there's sendable content, calls onQueue instead of onSubmit */
  isAgentRunning?: boolean;
  /** Controls what the default send action (Enter or send button) does
   *  when the agent is running. "interrupt" sends immediately, "queue" queues. */
  defaultSendBehavior?: "interrupt" | "queue";
  /** Callback for queue button when agent is running */
  onQueue?: (payload: MessagePayload) => void;
  /** Optional handler used when submit button is in loading state. */
  onSubmitLoadingPress?: () => void;
  /** Intercept key press events before default handling. Return true to prevent default. */
  onKeyPress?: (event: { key: string; preventDefault: () => void }) => boolean;
  /** Reports cursor selection updates from the underlying input. */
  onSelectionChange?: (selection: { start: number; end: number }) => void;
  onFocusChange?: (focused: boolean) => void;
  onHeightChange?: (height: number) => void;
  /** Extra styles merged onto the input wrapper (e.g. elevated background). */
  inputWrapperStyle?: import("react-native").ViewStyle;
  /** Content rendered inside the bordered input surface, above the text input (e.g. attachment pills). */
  attachmentSlot?: React.ReactNode;
}

export interface MessageInputRef {
  focus: () => void;
  blur: () => void;
  runKeyboardAction: (action: MessageInputKeyboardActionKind) => boolean;
  /**
   * Web-only: return the underlying DOM element for focus assertions/retries.
   * May return null if not mounted or on native.
   */
  getNativeElement?: () => HTMLElement | null;
}

const MIN_INPUT_HEIGHT_MOBILE = 30;
const MIN_INPUT_HEIGHT_DESKTOP = 46;
const DEFAULT_MAX_INPUT_HEIGHT = 160;
const MAX_INPUT_VIEWPORT_RATIO = 0.5;
const MIN_INPUT_HEIGHT = isWeb ? MIN_INPUT_HEIGHT_DESKTOP : MIN_INPUT_HEIGHT_MOBILE;
const ATTACHMENT_SHEET_SNAP_POINTS = ["34%", "45%"];

type WebTextInputKeyPressEvent = NativeSyntheticEvent<
  TextInputKeyPressEventData & {
    metaKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    // Web-only: present on DOM KeyboardEvent during IME composition (CJK input).
    isComposing?: boolean;
    keyCode?: number;
  }
>;

interface TextAreaHandle {
  scrollHeight?: number;
  clientHeight?: number;
  offsetHeight?: number;
  scrollTop?: number;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  style?: {
    height?: string;
    overflowY?: string;
  } & Record<string, unknown>;
}

function AttachButtonIcon({
  hovered,
  onAttachButtonRef,
  buttonIconSize,
}: {
  hovered: boolean;
  onAttachButtonRef: ((node: View | null) => void) | undefined;
  buttonIconSize: number;
}) {
  const colorMapping = hovered ? iconForegroundMapping : iconForegroundMutedMapping;
  return (
    <View ref={onAttachButtonRef} collapsable={false} style={styles.attachButtonAnchor}>
      <ThemedPlus size={buttonIconSize} uniProps={colorMapping} />
    </View>
  );
}

function AttachmentMenuList({ items }: { items: AttachmentMenuItem[] }) {
  return (
    <>
      {items.map((item) => (
        <DropdownMenuItem
          key={item.id}
          testID={`message-input-attachment-menu-item-${item.id}`}
          disabled={item.disabled}
          onSelect={item.onSelect}
          leading={item.icon ?? null}
        >
          {item.label}
        </DropdownMenuItem>
      ))}
    </>
  );
}

function AttachmentSheetItem({
  item,
  onSelect,
}: {
  item: AttachmentMenuItem;
  onSelect: (item: AttachmentMenuItem) => void;
}) {
  const handlePress = useCallback(() => {
    onSelect(item);
  }, [item, onSelect]);
  const pressableStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.attachmentSheetItem,
      pressed && styles.attachmentSheetItemPressed,
      item.disabled && styles.buttonDisabled,
    ],
    [item.disabled],
  );

  return (
    <Pressable
      testID={`message-input-attachment-menu-item-${item.id}`}
      accessibilityRole="button"
      disabled={item.disabled}
      onPress={handlePress}
      style={pressableStyle}
    >
      {item.icon ? <View style={styles.attachmentSheetItemIcon}>{item.icon}</View> : null}
      <Text style={styles.attachmentSheetItemText}>{item.label}</Text>
    </Pressable>
  );
}

function AttachmentSheetList({
  items,
  onSelect,
}: {
  items: AttachmentMenuItem[];
  onSelect: (item: AttachmentMenuItem) => void;
}) {
  return (
    <View style={styles.attachmentSheetList}>
      {items.map((item) => (
        <AttachmentSheetItem key={item.id} item={item} onSelect={onSelect} />
      ))}
    </View>
  );
}

function AttachmentDropdown({
  isConnected,
  disabled,
  attachButtonStyle,
  renderAttachButtonIcon,
  attachmentMenuItems,
  addAttachmentLabel,
}: {
  isConnected: boolean;
  disabled: boolean;
  attachButtonStyle: React.ComponentProps<typeof DropdownMenuTrigger>["style"];
  renderAttachButtonIcon: (input: { hovered?: boolean }) => React.ReactElement;
  attachmentMenuItems: AttachmentMenuItem[];
  addAttachmentLabel: string;
}) {
  const isCompact = useIsCompactFormFactor();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  useDismissKeyboardOnOpen(isSheetOpen, isCompact);

  const isButtonDisabled = !isConnected || disabled;
  const attachmentSheetHeader = useMemo<SheetHeader>(
    () => ({ title: addAttachmentLabel }),
    [addAttachmentLabel],
  );
  const handleOpenSheet = useCallback(() => {
    if (isButtonDisabled) return;
    setIsSheetOpen(true);
  }, [isButtonDisabled]);
  const handleCloseSheet = useCallback(() => {
    setIsSheetOpen(false);
  }, []);
  const handleSheetItemSelect = useCallback((item: AttachmentMenuItem) => {
    if (item.disabled) return;
    setIsSheetOpen(false);
    if (Platform.OS === "ios") {
      setTimeout(item.onSelect, 250);
      return;
    }
    item.onSelect();
  }, []);
  const mobileAttachButtonStyle = useCallback(
    (state: { pressed: boolean; hovered?: boolean }) => {
      if (typeof attachButtonStyle === "function") {
        return attachButtonStyle({ ...state, hovered: Boolean(state.hovered), open: isSheetOpen });
      }
      return attachButtonStyle;
    },
    [attachButtonStyle, isSheetOpen],
  );
  const renderMobileAttachButtonIcon = useCallback(
    ({ hovered }: { hovered?: boolean }) => renderAttachButtonIcon({ hovered }),
    [renderAttachButtonIcon],
  );

  if (isCompact) {
    return (
      <>
        <Pressable
          disabled={isButtonDisabled}
          accessibilityLabel={addAttachmentLabel}
          accessibilityRole="button"
          testID="message-input-attach-button"
          onPress={handleOpenSheet}
          style={mobileAttachButtonStyle}
        >
          {renderMobileAttachButtonIcon}
        </Pressable>
        <AdaptiveModalSheet
          header={attachmentSheetHeader}
          visible={isSheetOpen}
          onClose={handleCloseSheet}
          snapPoints={ATTACHMENT_SHEET_SNAP_POINTS}
          testID="message-input-attachment-menu"
        >
          <AttachmentSheetList items={attachmentMenuItems} onSelect={handleSheetItemSelect} />
        </AdaptiveModalSheet>
      </>
    );
  }

  return (
    <DropdownMenu>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            disabled={isButtonDisabled}
            accessibilityLabel={addAttachmentLabel}
            accessibilityRole="button"
            testID="message-input-attach-button"
            style={attachButtonStyle}
          >
            {renderAttachButtonIcon}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>{addAttachmentLabel}</Text>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side="top"
        align="start"
        offset={8}
        minWidth={220}
        testID="message-input-attachment-menu"
      >
        <AttachmentMenuList items={attachmentMenuItems} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type ShortcutChord = NonNullable<React.ComponentProps<typeof Shortcut>["chord"]>;

function SendTooltipBody({
  label,
  sendKeys,
}: {
  label: string;
  sendKeys: ShortcutChord | null | undefined;
}) {
  return (
    <View style={styles.tooltipRow}>
      <Text style={styles.tooltipText}>{label}</Text>
      {sendKeys ? <Shortcut chord={sendKeys} /> : null}
    </View>
  );
}

function SendButtonContent({
  isSubmitLoading,
  submitIcon,
  buttonIconSize,
}: {
  isSubmitLoading: boolean;
  submitIcon: "arrow" | "return";
  buttonIconSize: number;
}) {
  if (isSubmitLoading) {
    return <ThemedActivityIndicator size="small" uniProps={iconAccentForegroundMapping} />;
  }
  if (submitIcon === "return") {
    return <ThemedCornerDownLeft size={buttonIconSize} uniProps={iconAccentForegroundMapping} />;
  }
  return <ThemedArrowUp size={buttonIconSize} uniProps={iconAccentForegroundMapping} />;
}

interface DesktopKeyPressContext {
  onKeyPressCallback: ((event: { key: string; preventDefault: () => void }) => boolean) | undefined;
  submitOnEnter: boolean;
  isAgentRunning: boolean;
  onQueue: ((payload: MessagePayload) => void) | undefined;
  isSubmitDisabled: boolean;
  isSubmitLoading: boolean;
  disabled: boolean;
  handleAlternateSendAction: () => void;
  handleDefaultSendAction: () => void;
}

function handleDesktopKeyPressImpl(
  event: WebTextInputKeyPressEvent,
  ctx: DesktopKeyPressContext,
): void {
  if (isImeComposingKeyboardEvent(event.nativeEvent)) return;

  if (ctx.onKeyPressCallback) {
    const handled = ctx.onKeyPressCallback({
      key: event.nativeEvent.key,
      preventDefault: () => event.preventDefault(),
    });
    if (handled) return;
  }

  const { shiftKey, metaKey, ctrlKey } = event.nativeEvent;

  if (event.nativeEvent.key !== "Enter") return;
  if (!ctx.submitOnEnter) return;
  if (shiftKey) return;

  if ((metaKey || ctrlKey) && ctx.isAgentRunning && ctx.onQueue) {
    if (ctx.isSubmitDisabled || ctx.isSubmitLoading || ctx.disabled) return;
    event.preventDefault();
    ctx.handleAlternateSendAction();
    return;
  }

  if (ctx.isSubmitDisabled || ctx.isSubmitLoading || ctx.disabled) return;
  event.preventDefault();
  ctx.handleDefaultSendAction();
}

interface KeyboardActionHandlers {
  textInputRef: React.MutableRefObject<
    TextInput | (TextInput & { getNativeRef?: () => unknown }) | null
  >;
}

function runKeyboardActionImpl(
  action: MessageInputKeyboardActionKind,
  h: KeyboardActionHandlers,
): boolean {
  if (action === "focus") {
    h.textInputRef.current?.focus();
    return true;
  }
  return false;
}

function getTextInputNativeElement(
  current: TextInput | (TextInput & { getNativeRef?: () => unknown }) | null,
): HTMLElement | null {
  if (!current) return null;
  const handle = current as TextInput & { getNativeRef?: () => unknown };
  const native = typeof handle.getNativeRef === "function" ? handle.getNativeRef() : current;
  return native instanceof HTMLElement ? native : null;
}

interface PasteImagesEffectArgs {
  getWebTextArea: () => TextAreaHandle | null;
  isConnected: boolean;
  disabled: boolean;
  onAddImages: ((images: ImageAttachment[]) => void) | undefined;
}

function usePasteImagesEffect(args: PasteImagesEffectArgs): void {
  const { getWebTextArea, isConnected, disabled, onAddImages } = args;

  useEffect(() => {
    if (!isWeb || !onAddImages) return;

    const textarea = getWebTextArea() as
      | (TextAreaHandle & {
          addEventListener?: (type: string, listener: (e: ClipboardEvent) => void) => void;
          removeEventListener?: (type: string, listener: (e: ClipboardEvent) => void) => void;
        })
      | null;
    if (
      !textarea ||
      typeof textarea.addEventListener !== "function" ||
      typeof textarea.removeEventListener !== "function"
    ) {
      return;
    }

    let disposed = false;
    const handlePaste = (event: ClipboardEvent) => {
      if (!isConnected || disabled) return;

      const imageFiles = collectImageFilesFromClipboardData(event.clipboardData);
      if (imageFiles.length === 0) return;

      event.preventDefault();

      void filesToImageAttachments(imageFiles)
        .then((pastedAttachments) => {
          if (disposed || pastedAttachments.length === 0) return;
          onAddImages(pastedAttachments);
          return;
        })
        .catch((error) => {
          console.error("[MessageInput] Failed to process pasted images:", error);
        });
    };

    textarea.addEventListener("paste", handlePaste);
    return () => {
      disposed = true;
      textarea.removeEventListener?.("paste", handlePaste);
    };
  }, [disabled, getWebTextArea, isConnected, onAddImages]);
}

function useAutoFocusOnWebEffect(
  textInputRef: React.MutableRefObject<
    TextInput | (TextInput & { getNativeRef?: () => unknown }) | null
  >,
  autoFocus: boolean,
  autoFocusKey: string | undefined,
): void {
  useEffect(() => {
    if (!isWeb || !autoFocus) return;
    return focusWithRetries({
      focus: () => textInputRef.current?.focus(),
      isFocused: () => {
        const element = getTextInputNativeElement(textInputRef.current);
        const active = typeof document !== "undefined" ? document.activeElement : null;
        return Boolean(element) && active === element;
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus, autoFocusKey]);
}

function FocusHint({
  visible,
  focusInputKeys,
  label,
}: {
  visible: boolean;
  focusInputKeys: ShortcutChord | null | undefined;
  label: string;
}) {
  if (!visible || !focusInputKeys || !label.trim()) return null;
  return (
    <Text style={styles.focusHintText} pointerEvents="none">
      {label}
    </Text>
  );
}

function SendButtonTooltip({
  shouldShow,
  canPressLoadingButton,
  onSubmitLoadingPress,
  onDefaultSendAction,
  isSendButtonDisabled,
  submitAccessibilityLabel,
  sendButtonCombinedStyle,
  isSubmitLoading,
  submitIcon,
  submitButtonTestID,
  buttonIconSize,
  sendKeys,
  sendTooltipLabel,
}: {
  shouldShow: boolean;
  canPressLoadingButton: boolean;
  onSubmitLoadingPress: (() => void) | undefined;
  onDefaultSendAction: () => void;
  isSendButtonDisabled: boolean;
  submitAccessibilityLabel: string;
  sendButtonCombinedStyle: React.ComponentProps<typeof TooltipTrigger>["style"];
  isSubmitLoading: boolean;
  submitIcon: "arrow" | "return";
  submitButtonTestID: string | undefined;
  buttonIconSize: number;
  sendKeys: ShortcutChord | null | undefined;
  sendTooltipLabel: string;
}) {
  if (!shouldShow) return null;
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        onPress={canPressLoadingButton ? onSubmitLoadingPress : onDefaultSendAction}
        disabled={isSendButtonDisabled}
        accessibilityLabel={submitAccessibilityLabel}
        accessibilityRole="button"
        testID={submitButtonTestID}
        style={sendButtonCombinedStyle}
      >
        <SendButtonContent
          isSubmitLoading={isSubmitLoading}
          submitIcon={submitIcon}
          buttonIconSize={buttonIconSize}
        />
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <SendTooltipBody label={sendTooltipLabel} sendKeys={sendKeys} />
      </TooltipContent>
    </Tooltip>
  );
}

interface SendMessageContext {
  value: string;
  attachments: ComposerAttachment[];
  hasExternalContent: boolean;
  allowEmptySubmit: boolean;
  cwd: string;
  isAgentRunning: boolean;
  onSubmit: (payload: MessagePayload) => void;
  onMinimizeHeight: () => void;
  preserveHeightOnSubmit: boolean;
}

function sendMessageImpl(ctx: SendMessageContext): void {
  const trimmed = ctx.value.trim();
  if (
    !trimmed &&
    ctx.attachments.length === 0 &&
    !ctx.hasExternalContent &&
    !ctx.allowEmptySubmit
  ) {
    return;
  }
  ctx.onSubmit({
    text: trimmed,
    attachments: ctx.attachments,
    cwd: ctx.cwd,
    forceSend: ctx.isAgentRunning || undefined,
  });
  // When the host preserves and locks the composer (e.g. new-workspace creation),
  // the text stays put — collapsing the height would clip it. Keep it grown.
  if (!ctx.preserveHeightOnSubmit) {
    ctx.onMinimizeHeight();
  }
}

interface QueueMessageContext {
  value: string;
  attachments: ComposerAttachment[];
  cwd: string;
  onQueue: ((payload: MessagePayload) => void) | undefined;
  onChangeText: (text: string) => void;
  onMinimizeHeight: () => void;
}

function queueMessageImpl(ctx: QueueMessageContext): void {
  if (!ctx.onQueue) return;
  const trimmed = ctx.value.trim();
  if (!trimmed && ctx.attachments.length === 0) return;
  ctx.onQueue({ text: trimmed, attachments: ctx.attachments, cwd: ctx.cwd });
  ctx.onChangeText("");
  ctx.onMinimizeHeight();
}

interface SendableContentInput {
  value: string;
  attachments: ComposerAttachment[];
  hasExternalContent: boolean;
  allowEmptySubmit: boolean;
  isSubmitLoading: boolean;
}

interface SendableContentOutput {
  hasAttachments: boolean;
  hasRealContent: boolean;
  hasSendableContent: boolean;
  shouldShowSendButton: boolean;
}

function computeSendableContent(input: SendableContentInput): SendableContentOutput {
  const hasAttachments = input.attachments.length > 0;
  const hasRealContent = input.value.trim().length > 0 || hasAttachments;
  const hasSendableContent = hasRealContent || input.hasExternalContent;
  const shouldShowSendButton =
    hasSendableContent || input.allowEmptySubmit || input.isSubmitLoading;
  return { hasAttachments, hasRealContent, hasSendableContent, shouldShowSendButton };
}

function resolveMaxInputHeight(windowHeight: number): number {
  if (!Number.isFinite(windowHeight) || windowHeight <= 0) return DEFAULT_MAX_INPUT_HEIGHT;
  return Math.max(DEFAULT_MAX_INPUT_HEIGHT, Math.floor(windowHeight * MAX_INPUT_VIEWPORT_RATIO));
}

function computeTextInputHeightStyle(inputHeight: number, maxInputHeight: number) {
  if (isWeb) {
    return {
      height: inputHeight,
      minHeight: MIN_INPUT_HEIGHT,
      maxHeight: maxInputHeight,
    };
  }
  return {
    minHeight: MIN_INPUT_HEIGHT,
    maxHeight: maxInputHeight,
  };
}

function isTextAreaLike(v: unknown): v is TextAreaHandle {
  return typeof v === "object" && v !== null && "scrollHeight" in v;
}

function getWebTextAreaImpl(
  current: TextInput | (TextInput & { getNativeRef?: () => unknown }) | null,
): TextAreaHandle | null {
  if (!current) return null;
  const candidate = current as { getNativeRef?: () => unknown };
  if (typeof candidate.getNativeRef === "function") {
    const native = candidate.getNativeRef();
    if (isTextAreaLike(native)) return native;
  }
  if (isTextAreaLike(current)) return current;
  return null;
}

interface SendButtonStateInput {
  disabled: boolean;
  isSubmitDisabled: boolean;
  isSubmitLoading: boolean;
  onSubmitLoadingPress: (() => void) | undefined;
  defaultSendBehavior: "interrupt" | "queue";
  isAgentRunning: boolean;
}

interface SendButtonStateOutput {
  canPressLoadingButton: boolean;
  isSendButtonDisabled: boolean;
  defaultActionQueues: boolean;
}

function computeSendButtonState(input: SendButtonStateInput): SendButtonStateOutput {
  const canPressLoadingButton =
    input.isSubmitLoading && typeof input.onSubmitLoadingPress === "function";
  const isSendButtonDisabled =
    input.disabled || (!canPressLoadingButton && (input.isSubmitDisabled || input.isSubmitLoading));
  const defaultActionQueues = input.defaultSendBehavior === "queue" && input.isAgentRunning;
  return { canPressLoadingButton, isSendButtonDisabled, defaultActionQueues };
}

interface ResolvedMessageInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: (payload: MessagePayload) => void;
  hasExternalContent: boolean;
  allowEmptySubmit: boolean;
  submitButtonAccessibilityLabel: string | undefined;
  submitButtonTestID: string | undefined;
  submitIcon: "arrow" | "return";
  isSubmitDisabled: boolean;
  isSubmitLoading: boolean;
  preserveHeightOnSubmit: boolean;
  attachments: ComposerAttachment[];
  cwd: string;
  attachmentMenuItems: AttachmentMenuItem[];
  onAttachButtonRef: ((node: View | null) => void) | undefined;
  onAddImages: ((images: ImageAttachment[]) => void) | undefined;
  client: DaemonClient | null;
  placeholder: string | undefined;
  autoFocus: boolean;
  autoFocusKey: string | undefined;
  disabled: boolean;
  isPaneFocused: boolean;
  leftContent: React.ReactNode;
  rightContent: React.ReactNode;
  isAgentRunning: boolean;
  defaultSendBehavior: "interrupt" | "queue";
  onQueue: ((payload: MessagePayload) => void) | undefined;
  onSubmitLoadingPress: (() => void) | undefined;
  onKeyPressCallback: ((event: { key: string; preventDefault: () => void }) => boolean) | undefined;
  onSelectionChangeCallback: ((selection: { start: number; end: number }) => void) | undefined;
  onFocusChange: ((focused: boolean) => void) | undefined;
  onHeightChange: ((height: number) => void) | undefined;
  inputWrapperStyle: import("react-native").ViewStyle | undefined;
  attachmentSlot: React.ReactNode;
}

function resolveMessageInputProps(props: MessageInputProps): ResolvedMessageInputProps {
  return {
    value: props.value,
    onChangeText: props.onChangeText,
    onSubmit: props.onSubmit,
    hasExternalContent: props.hasExternalContent ?? false,
    allowEmptySubmit: props.allowEmptySubmit ?? false,
    submitButtonAccessibilityLabel: props.submitButtonAccessibilityLabel,
    submitButtonTestID: props.submitButtonTestID,
    submitIcon: props.submitIcon ?? "arrow",
    isSubmitDisabled: props.isSubmitDisabled ?? false,
    isSubmitLoading: props.isSubmitLoading ?? false,
    preserveHeightOnSubmit: props.preserveHeightOnSubmit ?? false,
    attachments: props.attachments,
    cwd: props.cwd,
    attachmentMenuItems: props.attachmentMenuItems,
    onAttachButtonRef: props.onAttachButtonRef,
    onAddImages: props.onAddImages,
    client: props.client,
    placeholder: props.placeholder,
    autoFocus: props.autoFocus ?? false,
    autoFocusKey: props.autoFocusKey,
    disabled: props.disabled ?? false,
    isPaneFocused: props.isPaneFocused ?? true,
    leftContent: props.leftContent,
    rightContent: props.rightContent,
    isAgentRunning: props.isAgentRunning ?? false,
    defaultSendBehavior: props.defaultSendBehavior ?? "interrupt",
    onQueue: props.onQueue,
    onSubmitLoadingPress: props.onSubmitLoadingPress,
    onKeyPressCallback: props.onKeyPress,
    onSelectionChangeCallback: props.onSelectionChange,
    onFocusChange: props.onFocusChange,
    onHeightChange: props.onHeightChange,
    inputWrapperStyle: props.inputWrapperStyle,
    attachmentSlot: props.attachmentSlot,
  };
}

export const MessageInput = forwardRef<MessageInputRef, MessageInputProps>(
  function MessageInput(props, ref) {
    const {
      value,
      onChangeText,
      onSubmit,
      hasExternalContent,
      allowEmptySubmit,
      submitButtonAccessibilityLabel,
      submitButtonTestID,
      submitIcon,
      isSubmitDisabled,
      isSubmitLoading,
      preserveHeightOnSubmit,
      attachments,
      cwd,
      attachmentMenuItems,
      onAttachButtonRef,
      onAddImages,
      client,
      placeholder,
      autoFocus,
      autoFocusKey,
      disabled,
      isPaneFocused,
      leftContent,
      rightContent,
      isAgentRunning,
      defaultSendBehavior,
      onQueue,
      onSubmitLoadingPress,
      onKeyPressCallback,
      onSelectionChangeCallback,
      onFocusChange,
      onHeightChange,
      inputWrapperStyle,
      attachmentSlot,
    } = resolveMessageInputProps(props);
    const { t } = useTranslation();
    const isCompact = useIsCompactFormFactor();
    const { height: windowHeight } = useWindowDimensions();
    const maxInputHeight = resolveMaxInputHeight(windowHeight);
    const buttonIconSize = isWeb ? ICON_SIZE.md : ICON_SIZE.lg;
    const focusInputKeys = useShortcutKeys("focus-message-input");
    const [inputHeight, setInputHeight] = useState(MIN_INPUT_HEIGHT);
    const [isInputFocused, setIsInputFocused] = useState(false);
    const textInputRef = useRef<TextInput | (TextInput & { getNativeRef?: () => unknown }) | null>(
      null,
    );

    useImperativeHandle(ref, () => ({
      focus: () => {
        textInputRef.current?.focus();
      },
      blur: () => {
        textInputRef.current?.blur?.();
      },
      runKeyboardAction: (action) => runKeyboardActionImpl(action, { textInputRef }),
      getNativeElement: () => (isWeb ? getTextInputNativeElement(textInputRef.current) : null),
    }));
    const inputHeightRef = useRef(MIN_INPUT_HEIGHT);
    const valueRef = useRef(value);
    const isConnected = client?.isConnected ?? false;

    useEffect(() => {
      valueRef.current = value;
    }, [value]);

    useEffect(() => {
      return () => {
        onFocusChange?.(false);
      };
    }, [onFocusChange]);

    useAutoFocusOnWebEffect(textInputRef, autoFocus, autoFocusKey);

    const minimizeInputHeight = useCallback(() => {
      inputHeightRef.current = MIN_INPUT_HEIGHT;
      setInputHeight(MIN_INPUT_HEIGHT);
      onHeightChange?.(MIN_INPUT_HEIGHT);
    }, [onHeightChange]);

    const handleSendMessage = useCallback(
      () =>
        sendMessageImpl({
          value: valueRef.current,
          attachments,
          hasExternalContent,
          allowEmptySubmit,
          cwd,
          isAgentRunning,
          onSubmit,
          onMinimizeHeight: minimizeInputHeight,
          preserveHeightOnSubmit,
        }),
      [
        allowEmptySubmit,
        attachments,
        cwd,
        onSubmit,
        isAgentRunning,
        hasExternalContent,
        minimizeInputHeight,
        preserveHeightOnSubmit,
      ],
    );

    const handleQueueMessage = useCallback(
      () =>
        queueMessageImpl({
          value: valueRef.current,
          attachments,
          cwd,
          onQueue,
          onChangeText,
          onMinimizeHeight: minimizeInputHeight,
        }),
      [attachments, cwd, onQueue, onChangeText, minimizeInputHeight],
    );

    const handleDefaultSendAction = useCallback(() => {
      runDefaultSendAction({
        defaultSendBehavior,
        isAgentRunning,
        onQueue,
        handleSendMessage,
        handleQueueMessage,
      });
    }, [defaultSendBehavior, isAgentRunning, onQueue, handleQueueMessage, handleSendMessage]);

    const handleAlternateSendAction = useCallback(() => {
      runAlternateSendAction({
        defaultSendBehavior,
        isAgentRunning,
        onQueue,
        handleSendMessage,
        handleQueueMessage,
      });
    }, [defaultSendBehavior, isAgentRunning, handleSendMessage, handleQueueMessage, onQueue]);

    const getWebTextArea = useCallback(
      (): TextAreaHandle | null => getWebTextAreaImpl(textInputRef.current),
      [],
    );

    const webTextareaRef = useRef<HTMLElement | null>(null);

    useLayoutEffect(() => {
      if (isWeb) {
        webTextareaRef.current = getWebTextArea() as HTMLElement | null;
      }
    }, [getWebTextArea]);

    const inputScrollbar = useWebElementScrollbar(webTextareaRef, {
      enabled: isWeb,
      reserveStableGutter: true,
    });

    usePasteImagesEffect({
      getWebTextArea,
      isConnected,
      disabled,
      onAddImages,
    });

    const setBoundedInputHeight = useCallback(
      (nextHeight: number) => {
        const bounded = Math.max(MIN_INPUT_HEIGHT, Math.min(maxInputHeight, nextHeight));
        if (Math.abs(inputHeightRef.current - bounded) < 1) return;
        inputHeightRef.current = bounded;
        setInputHeight(bounded);
        onHeightChange?.(bounded);
      },
      [maxInputHeight, onHeightChange],
    );

    useEffect(() => {
      setBoundedInputHeight(inputHeightRef.current);
    }, [setBoundedInputHeight]);

    useComposerHeightMirror({
      value,
      textareaRef: webTextareaRef,
      minHeight: MIN_INPUT_HEIGHT,
      maxHeight: maxInputHeight,
      onHeight: setBoundedInputHeight,
    });

    const handleContentSizeChange = useCallback(
      (event: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
        if (isWeb) return;
        setBoundedInputHeight(event.nativeEvent.contentSize.height);
      },
      [setBoundedInputHeight],
    );

    const handleSelectionChange = useCallback(
      (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
        const start = event.nativeEvent.selection?.start ?? 0;
        const end = event.nativeEvent.selection?.end ?? start;
        onSelectionChangeCallback?.({ start, end });
      },
      [onSelectionChangeCallback],
    );

    const shouldHandleWebKeyPress = isWeb;
    const shouldSubmitOnEnter = isWeb && !isCompact;

    function handleDesktopKeyPress(event: WebTextInputKeyPressEvent) {
      if (!shouldHandleWebKeyPress) return;
      handleDesktopKeyPressImpl(event, {
        onKeyPressCallback,
        submitOnEnter: shouldSubmitOnEnter,
        isAgentRunning,
        onQueue,
        isSubmitDisabled,
        isSubmitLoading,
        disabled,
        handleAlternateSendAction,
        handleDefaultSendAction,
      });
    }

    const { shouldShowSendButton } = computeSendableContent({
      value,
      attachments,
      hasExternalContent,
      allowEmptySubmit,
      isSubmitLoading,
    });
    const { canPressLoadingButton, isSendButtonDisabled, defaultActionQueues } =
      computeSendButtonState({
        disabled,
        isSubmitDisabled,
        isSubmitLoading,
        onSubmitLoadingPress,
        defaultSendBehavior,
        isAgentRunning,
      });
    useIosHardwareKeyboardSubmit({
      isEnabled: isInputFocused && !isSendButtonDisabled,
      onSubmit: handleDefaultSendAction,
    });
    const submitAccessibilityLabel = resolveSubmitAccessibilityLabel({
      submitButtonAccessibilityLabel,
      canPressLoadingButton,
      defaultActionQueues,
      isAgentRunning,
      t,
    });

    const sendTooltipLabel = resolveSendTooltipLabel({
      submitButtonAccessibilityLabel,
      defaultActionQueues,
      t,
    });

    const handleInputChange = useCallback(
      (nextValue: string) => {
        valueRef.current = nextValue;
        onChangeText(nextValue);
      },
      [onChangeText],
    );

    const handleInputFocus = useCallback(() => {
      setIsInputFocused(true);
      onFocusChange?.(true);
    }, [onFocusChange]);

    const handleInputBlur = useCallback(() => {
      setIsInputFocused(false);
      onFocusChange?.(false);
    }, [onFocusChange]);

    const attachButtonStyle = useCallback(
      ({ hovered }: { hovered?: boolean }) => [
        styles.attachButton,
        Boolean(hovered) && styles.iconButtonHovered,
        (!isConnected || disabled) && styles.buttonDisabled,
      ],
      [isConnected, disabled],
    );

    const inputWrapperCombinedStyle = useMemo(
      () => [styles.inputWrapper, inputWrapperStyle],
      [inputWrapperStyle],
    );
    const textInputStyle = useMemo(
      () => [styles.textInput, computeTextInputHeightStyle(inputHeight, maxInputHeight)],
      [inputHeight, maxInputHeight],
    );
    const sendButtonCombinedStyle = useMemo(
      () => [styles.sendButton, isSendButtonDisabled && styles.buttonDisabled],
      [isSendButtonDisabled],
    );
    const renderAttachButtonIcon = useCallback(
      ({ hovered }: { hovered?: boolean }) => (
        <AttachButtonIcon
          hovered={Boolean(hovered)}
          onAttachButtonRef={onAttachButtonRef}
          buttonIconSize={buttonIconSize}
        />
      ),
      [onAttachButtonRef, buttonIconSize],
    );

    return (
      <View style={styles.container} testID="message-input-root">
        <View style={inputWrapperCombinedStyle}>
          {attachmentSlot}
          {/* Text input */}
          <View style={styles.textInputScrollWrapper}>
            <ThemedTextInput
              ref={textInputRef}
              value={value}
              onChangeText={handleInputChange}
              placeholder={placeholder ?? t("composer.placeholders.fallback")}
              uniProps={textInputPlaceholderColorMapping}
              accessibilityLabel={t("composer.input.accessibilityLabel")}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
              style={textInputStyle}
              multiline
              scrollEnabled={isWeb ? inputHeight >= maxInputHeight : true}
              onContentSizeChange={handleContentSizeChange}
              editable={!disabled}
              onKeyPress={shouldHandleWebKeyPress ? handleDesktopKeyPress : undefined}
              onSelectionChange={handleSelectionChange}
              autoFocus={isWeb && autoFocus}
            />
            {inputScrollbar}
            <FocusHint
              visible={isWeb && isPaneFocused && !isInputFocused && !value}
              focusInputKeys={focusInputKeys}
              label={t("composer.input.focusHint", {
                shortcut: focusInputKeys ? formatShortcut(focusInputKeys[0], getShortcutOs()) : "",
              })}
            />
          </View>

          {/* Button row */}
          <View style={styles.buttonRow}>
            {/* Toolbar left: attachment button + agent controls */}
            <View style={styles.leftButtonGroup}>
              <AttachmentDropdown
                isConnected={isConnected}
                disabled={disabled}
                attachButtonStyle={attachButtonStyle}
                renderAttachButtonIcon={renderAttachButtonIcon}
                attachmentMenuItems={attachmentMenuItems}
                addAttachmentLabel={t("composer.input.addAttachment")}
              />
              {leftContent}
            </View>

            {/* Right: contextual content and send/cancel actions. */}
            <View style={styles.rightButtonGroup}>
              {rightContent}
              <SendButtonTooltip
                shouldShow={shouldShowSendButton}
                canPressLoadingButton={canPressLoadingButton}
                onSubmitLoadingPress={onSubmitLoadingPress}
                onDefaultSendAction={handleDefaultSendAction}
                isSendButtonDisabled={isSendButtonDisabled}
                submitAccessibilityLabel={submitAccessibilityLabel}
                sendButtonCombinedStyle={sendButtonCombinedStyle}
                isSubmitLoading={isSubmitLoading}
                submitIcon={submitIcon}
                submitButtonTestID={submitButtonTestID}
                buttonIconSize={buttonIconSize}
                sendKeys={DEFAULT_SEND_KEYS}
                sendTooltipLabel={sendTooltipLabel}
              />
            </View>
          </View>
        </View>
      </View>
    );
  },
);

const styles = StyleSheet.create((theme: Theme) => ({
  container: {
    position: "relative",
  },
  inputWrapper: {
    flexDirection: "column",
    gap: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius["2xl"],
    paddingVertical: {
      xs: theme.spacing[2],
      md: theme.spacing[4],
    },
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[4],
    },
    ...(isWeb
      ? {
          transitionProperty: "border-color",
          transitionDuration: "200ms",
          transitionTimingFunction: "ease-in-out",
        }
      : {}),
  },
  textInputScrollWrapper: {
    position: "relative",
  },
  focusHintText: {
    position: "absolute",
    top: 0,
    right: 0,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    opacity: 0.5,
  },
  textInput: {
    width: "100%",
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    lineHeight: theme.fontSize.base * 1.4,
    ...(isWeb
      ? ({
          outlineStyle: "none",
          outlineWidth: 0,
          outlineColor: "transparent",
        } as object)
      : {}),
  },
  buttonRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginHorizontal: -6,
  },
  leftButtonGroup: {
    minWidth: 0,
    flexShrink: 1,
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: theme.spacing[0],
  },
  rightButtonGroup: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  attachButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  attachButtonAnchor: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: theme.spacing[1],
  },
  iconButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  tooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  attachmentSheetList: {
    gap: theme.spacing[1],
  },
  attachmentSheetItem: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.xl,
  },
  attachmentSheetItemPressed: {
    backgroundColor: theme.colors.surface2,
  },
  attachmentSheetItemIcon: {
    width: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  attachmentSheetItemText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
})) as unknown as Record<string, object>;

const ThemedPlus = withUnistyles(Plus);
const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedCornerDownLeft = withUnistyles(CornerDownLeft);
const ThemedActivityIndicator = withUnistyles(ActivityIndicator);
const ThemedTextInput = withUnistyles(TextInput);

const iconForegroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const iconForegroundMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const iconAccentForegroundMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });
const textInputPlaceholderColorMapping = (theme: Theme) => ({
  placeholderTextColor: theme.colors.surface4,
});
