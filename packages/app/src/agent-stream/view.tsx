import React, {
  forwardRef,
  memo,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import {
  View,
  Text,
  Pressable,
  Platform,
  ActivityIndicator,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MAX_CONTENT_WIDTH, useIsCompactFormFactor } from "@/constants/layout";
import { useMutation } from "@tanstack/react-query";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { Check, ChevronDown, X } from "lucide-react-native";
import { usePanelStore } from "@/stores/panel-store";
import {
  AssistantMessage,
  UserMessage,
  ActivityLog,
  ToolCall,
  TodoListCard,
  CompactionMarker,
  MessageOuterSpacingProvider,
  type InlinePathTarget,
} from "@/components/message";
import { PlanCard } from "@/components/plan-card";
import { generateMessageId } from "@/utils/message-id";
import type { PendingAgentMessage } from "@/projection/pending-agent-messages";
import type { PendingPermission } from "@/types/shared";
import type {
  AgentCapabilityFlags,
  AgentPermissionAction,
  AgentPermissionResponse,
} from "@thoth/protocol/agent-types";
import type { AgentScreenAgent } from "@/hooks/use-agent-screen-state-machine";
import { useAuthorityProjection, useProjectionRuntime } from "@/projection/projection-context";
import { useHostFeature } from "@/runtime/host-features";
import { useFileExplorerActions } from "@/hooks/use-file-explorer-actions";
import { useLoadOlderAgentHistory } from "@/hooks/use-load-older-agent-history";
import type { ToastApi } from "@/components/toast-host";
import type { DaemonClient } from "@thoth/client/internal/daemon-client";
import type { ThothCardAnswerPayload } from "@thoth/protocol/thoth/rpc-schemas";
import { ToolCallDetailsContent } from "@/components/tool-call-details";
import { QuestionFormCard } from "@/components/question-form-card";
import { ClarifyDecisionCard } from "@/components/clarify-decision-card";
import { ThothApprovalCard } from "@/components/thoth-approval-card";
import { RegisteredTaskCard } from "@/components/registered-task-card";
import { ToolCallSheetProvider } from "@/components/tool-call-sheet";
import { type AgentStreamRenderModel, buildAgentStreamRenderModel } from "./model";
import { resolveStreamRenderStrategy } from "./strategy-resolver";
import { type StreamSegmentRenderers, type StreamViewportHandle } from "./strategy";
import {
  CompletedTurnFooterRow,
  TurnFooter,
  type AssistantTurnForkHandler,
  type TurnContentStrategy,
} from "./turn-footer";
import { layoutStream, type StreamLayoutItem } from "./layout";
import {
  type BottomAnchorLocalRequest,
  type BottomAnchorRouteRequest,
} from "./bottom-anchor-controller";
import {
  AssistantFileLinkResolverProvider,
  normalizeInlinePathTarget,
} from "@/assistant-file-links";
import {
  createWorkspaceFileTabTarget,
  normalizeWorkspaceFileLocation,
  type OpenFileDisposition,
  type WorkspaceFileOpenRequest,
} from "@/workspace/file-open";
import { navigateToPreparedWorkspaceTab } from "@/utils/workspace-navigation";
import { buildNewWorkspaceRoute } from "@/utils/host-routes";
import { useStableEvent } from "@/hooks/use-stable-event";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import { recordRenderProfileReasons } from "@/utils/render-profiler";
import { MountedTabActiveContext } from "@/components/split-container";
import { generateDraftId } from "@/stores/draft-keys";
import {
  buildDraftWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import type { WorkspaceComposerAttachment } from "@/attachments/types";
import type { WorkspaceDraftTabSetup, WorkspaceTabTarget } from "@/stores/workspace-tabs-store";
import { toErrorMessage } from "@/utils/error-messages";
import { useWorkspaceDraftSubmissionStore } from "@/stores/workspace-draft-submission-store";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import {
  resolveForegroundAgentStatus,
  shouldShowForegroundTurnSpinner,
} from "@/agent-thoth/foreground-state";
import {
  renderTimelineItem,
  timelineId,
  type TimelineRenderContext,
  type TimelineRenderItem,
  type TimelineRenderLayout,
} from "./timeline-view-registry";

function renderLiveAuxiliaryNode(input: {
  pendingPermissions: ReactNode;
  turnFooter: ReactNode;
}): ReactNode {
  if (!input.pendingPermissions && !input.turnFooter) {
    return null;
  }
  return (
    <>
      {input.turnFooter}
      {input.pendingPermissions ? (
        <View style={stylesheet.contentWrapper}>
          <View style={stylesheet.listHeaderContent}>{input.pendingPermissions}</View>
        </View>
      ) : null}
    </>
  );
}

function renderPendingPermissionsNode(input: {
  pendingPermissions: PendingPermission[];
  client: DaemonClient | null;
}): ReactNode {
  if (input.pendingPermissions.length === 0) {
    return null;
  }
  return (
    <View style={stylesheet.permissionsContainer}>
      {input.pendingPermissions.map((permission) => (
        <PermissionRequestCard key={permission.key} permission={permission} client={input.client} />
      ))}
    </View>
  );
}

function renderStreamItemWithTurnFooter(input: {
  content: ReactNode;
  layoutItem: StreamLayoutItem;
  strategy: TurnContentStrategy;
  onForkAssistantTurn?: AssistantTurnForkHandler;
}): ReactNode {
  if (!input.content) {
    return null;
  }

  const footerHost = input.layoutItem.completedFooter;
  const footer = footerHost ? (
    <CompletedTurnFooterRow
      strategy={input.strategy}
      items={footerHost.items}
      timing={footerHost.timing}
      startIndex={footerHost.startIndex}
      onForkAssistantTurn={input.onForkAssistantTurn}
    />
  ) : null;
  const content = (
    <StreamItemWrapper gapBelow={input.layoutItem.gapBelow}>{input.content}</StreamItemWrapper>
  );

  if (input.layoutItem.frameOrder === "footer-then-content") {
    return (
      <>
        {footer}
        {content}
      </>
    );
  }

  return (
    <>
      {content}
      {footer}
    </>
  );
}

function renderListEmptyComponent(input: {
  renderModel: AgentStreamRenderModel;
  emptyStateStyle: StyleProp<ViewStyle>;
  emptyText: string;
}): ReactNode {
  if (
    input.renderModel.boundary.hasVirtualizedHistory ||
    input.renderModel.boundary.hasMountedHistory ||
    input.renderModel.boundary.hasLiveHead ||
    input.renderModel.auxiliary.pendingPermissions ||
    input.renderModel.auxiliary.turnFooter
  ) {
    return null;
  }

  return (
    <View style={input.emptyStateStyle}>
      <Text style={stylesheet.emptyStateText}>{input.emptyText}</Text>
    </View>
  );
}

function renderHistoryStreamItem(input: {
  item: TimelineRenderItem;
  layoutItemById: Map<string, StreamLayoutItem>;
  renderStreamItem: (layoutItem: StreamLayoutItem) => ReactNode;
}): ReactNode {
  const layoutItem = input.layoutItemById.get(timelineId(input.item));
  if (!layoutItem) {
    return null;
  }
  return input.renderStreamItem(layoutItem);
}

function renderLiveHeadStreamItem(input: {
  item: TimelineRenderItem;
  layoutItemById: Map<string, StreamLayoutItem>;
  renderStreamItem: (layoutItem: StreamLayoutItem) => ReactNode;
}): ReactNode {
  const layoutItem = input.layoutItemById.get(timelineId(input.item));
  if (!layoutItem) {
    return null;
  }
  return input.renderStreamItem(layoutItem);
}

export interface AgentStreamViewHandle {
  scrollToBottom(reason?: BottomAnchorLocalRequest["reason"]): void;
  prepareForViewportChange(): void;
}

export interface AgentStreamViewProps {
  agentId: string;
  serverId?: string;
  agent: AgentScreenAgent;
  streamItems: TimelineRenderItem[];
  pendingPermissions: Map<string, PendingPermission>;
  routeBottomAnchorRequest?: BottomAnchorRouteRequest | null;
  isAuthoritativeHistoryReady?: boolean;
  toast?: ToastApi | null;
  approvalMode?: "quick" | "loop";
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
  onSubmitClarifyAnswer?: (cardId: string, answer: ThothCardAnswerPayload) => Promise<void> | void;
}

const AGENT_CAPABILITY_FLAG_KEYS: (keyof AgentCapabilityFlags)[] = [
  "supportsStreaming",
  "supportsSessionPersistence",
  "supportsDynamicModes",
  "supportsMcpServers",
  "supportsReasoningStream",
  "supportsToolInvocations",
  "supportsRewindConversation",
  "supportsRewindFiles",
  "supportsRewindBoth",
];

const EMPTY_STREAM_HEAD: TimelineRenderItem[] = [];

function buildChatHistoryAttachment(input: {
  draftId: string;
  serverId: string;
  agentId: string;
  payload: Awaited<ReturnType<DaemonClient["buildAgentForkContext"]>>;
  missingAttachmentMessage: string;
}): WorkspaceComposerAttachment {
  if (!input.payload.attachment) {
    throw new Error(input.missingAttachmentMessage);
  }
  return {
    kind: "chat_history",
    id: `chat_history:${input.draftId}`,
    attachment: input.payload.attachment,
    source: {
      serverId: input.serverId,
      agentId: input.agentId,
      boundaryMessageId: input.payload.boundaryMessageId,
      itemCount: input.payload.itemCount,
    },
  };
}

function buildForkDraftSetup(agent: AgentScreenAgent): WorkspaceDraftTabSetup | undefined {
  if (!agent.provider) {
    return undefined;
  }

  const featureValues: Record<string, unknown> = {};
  for (const feature of agent.features ?? []) {
    featureValues[feature.id] = feature.value;
  }

  return {
    provider: agent.provider,
    cwd: agent.cwd,
    modeId: agent.currentModeId ?? agent.runtimeInfo?.modeId ?? null,
    model: agent.model ?? agent.runtimeInfo?.model ?? null,
    thinkingOptionId: agent.thinkingOptionId ?? agent.runtimeInfo?.thinkingOptionId ?? null,
    featureValues,
  };
}

function buildForkDraftTabTarget(
  setup: WorkspaceDraftTabSetup | undefined,
  draftId: string,
): WorkspaceTabTarget {
  return setup ? { kind: "draft", draftId, setup } : { kind: "draft", draftId };
}

const AgentStreamViewComponent = forwardRef<AgentStreamViewHandle, AgentStreamViewProps>(
  function AgentStreamView(
    {
      agentId,
      serverId,
      agent,
      streamItems,
      pendingPermissions,
      routeBottomAnchorRequest = null,
      isAuthoritativeHistoryReady = true,
      toast,
      approvalMode,
      onOpenWorkspaceFile,
      onSubmitClarifyAnswer,
    },
    ref,
  ) {
    const { t } = useTranslation();
    const router = useRouter();
    const viewportRef = useRef<StreamViewportHandle | null>(null);
    const isMobile = useIsCompactFormFactor();
    const streamRenderStrategy = useMemo(
      () =>
        resolveStreamRenderStrategy({
          platform: Platform.OS,
          isMobileBreakpoint: isMobile,
        }),
      [isMobile],
    );
    const [isNearBottom, setIsNearBottom] = useState(true);
    const [expandedInlineToolCallIds, setExpandedInlineToolCallIds] = useState<Set<string>>(
      new Set(),
    );
    const openFileExplorerForCheckout = usePanelStore((state) => state.openFileExplorerForCheckout);
    const setExplorerTabForCheckout = usePanelStore((state) => state.setExplorerTabForCheckout);

    // Get serverId (fallback to agent's serverId if not provided)
    const resolvedServerId = serverId ?? agent.serverId ?? "";

    const client = useHostRuntimeClient(resolvedServerId);
    const projectionRuntime = useProjectionRuntime();
    const agentThothState = useAuthorityProjection(
      resolvedServerId,
      (projection) => projection.agentThothStates.get(agentId) ?? null,
    );
    const isHostConnected = useHostRuntimeIsConnected(resolvedServerId);
    const supportsAgentForkContext = useHostFeature(resolvedServerId, "agentForkContext");

    useEffect(() => {
      if (!client || !isHostConnected || !agentId) {
        return;
      }
      void projectionRuntime
        .service(resolvedServerId)
        ?.refreshAgentThothState(agentId)
        .catch(() => undefined);
    }, [agentId, client, isHostConnected, projectionRuntime, resolvedServerId]);

    const workspaceRoot = agent.cwd?.trim() || "";
    const { requestDirectoryListing } = useFileExplorerActions({
      serverId: resolvedServerId,
      workspaceId: agent.workspaceId,
      workspaceRoot,
    });
    const { isLoadingOlder, hasOlder, progressKey, loadOlder } = useLoadOlderAgentHistory({
      serverId: resolvedServerId,
      agentId,
      toast,
    });
    // Keep entry/exit animations off on Android due to RN dispatchDraw crashes
    // tracked in react-native-reanimated#8422.
    const shouldDisableEntryExitAnimations = Platform.OS === "android";
    const scrollIndicatorFadeIn = shouldDisableEntryExitAnimations
      ? undefined
      : FadeIn.duration(200);
    const scrollIndicatorFadeOut = shouldDisableEntryExitAnimations
      ? undefined
      : FadeOut.duration(200);

    useEffect(() => {
      setIsNearBottom(true);
      setExpandedInlineToolCallIds(new Set());
    }, [agentId]);

    const handleInlinePathPress = useStableEvent(
      (target: InlinePathTarget, disposition: OpenFileDisposition) => {
        if (!target.path) {
          return;
        }

        const normalized = normalizeInlinePathTarget(target.path, agent.cwd);
        if (!normalized) {
          return;
        }

        if (normalized.file) {
          const location = normalizeWorkspaceFileLocation({
            path: normalized.file,
            lineStart: target.lineStart,
            lineEnd: target.lineEnd,
          });
          if (!location) {
            return;
          }

          if (onOpenWorkspaceFile) {
            onOpenWorkspaceFile({
              location,
              disposition,
            });
            return;
          }

          if (agent.workspaceId) {
            navigateToPreparedWorkspaceTab({
              serverId: resolvedServerId,
              workspaceId: agent.workspaceId,
              target: createWorkspaceFileTabTarget(location),
            });
          }
          return;
        }

        void requestDirectoryListing(normalized.directory, {
          recordHistory: false,
          setCurrentPath: false,
        });

        const checkout = {
          serverId: resolvedServerId,
          cwd: agent.cwd,
          isGit: agent.projectPlacement?.checkout?.isGit ?? true,
        };
        setExplorerTabForCheckout({ ...checkout, tab: "files" });
        openFileExplorerForCheckout({
          isCompact: isMobile,
          checkout,
        });
      },
    );

    const handleToolCallOpenFile = useStableEvent((filePath: string) => {
      handleInlinePathPress({ raw: filePath, path: filePath }, "main");
    });

    const handleSubmitClarifyAnswer = useStableEvent(
      async (cardId: string, answer: ThothCardAnswerPayload) => {
        try {
          if (onSubmitClarifyAnswer) {
            await onSubmitClarifyAnswer(cardId, answer);
            return;
          }
          if (!client) {
            throw new Error(t("workspace.terminal.hostDisconnected"));
          }
          const authority = await client.getAgentThothState(agentId);
          if (authority.error) {
            throw new Error(authority.error);
          }
          if (authority.state.pendingCard?.card.id !== cardId) {
            throw new Error("This card is no longer the active Thoth decision.");
          }
          const result = await client.answerAgentThothCard({
            agentId,
            cardId,
            answer,
            expectedRevision: authority.state.revision,
            commandId: `card_${generateMessageId()}`,
          });
          if (result.error || result.conflict || !result.accepted) {
            throw new Error(result.error ?? "The Thoth decision changed on another client.");
          }
        } catch (error) {
          toast?.error(toErrorMessage(error));
        }
      },
    );

    const handleForkAssistantTurn: AssistantTurnForkHandler = useStableEvent(
      async ({ target, boundaryMessageId }) => {
        try {
          if (!supportsAgentForkContext) {
            toast?.error(t("message.actions.forkUnavailable"));
            return;
          }
          if (!client) {
            throw new Error(t("workspace.terminal.hostDisconnected"));
          }
          const draftSetup = buildForkDraftSetup(agent);
          const prepareForkDraft = async () => {
            const draftId = generateDraftId();
            const payload = await client.buildAgentForkContext(
              agentId,
              boundaryMessageId ? { boundaryMessageId } : {},
            );
            const attachment = buildChatHistoryAttachment({
              draftId,
              serverId: resolvedServerId,
              agentId,
              payload,
              missingAttachmentMessage: t("message.actions.forkFailed"),
            });
            useWorkspaceAttachmentsStore.getState().setWorkspaceAttachments({
              scopeKey: buildDraftWorkspaceAttachmentScopeKey(draftId),
              attachments: [attachment],
            });
            return draftId;
          };

          if (target === "tab") {
            const workspaceId = agent.workspaceId;
            if (!workspaceId) {
              throw new Error(t("message.actions.forkMissingWorkspace"));
            }
            const draftId = await prepareForkDraft();
            navigateToPreparedWorkspaceTab({
              serverId: resolvedServerId,
              workspaceId,
              target: buildForkDraftTabTarget(draftSetup, draftId),
            });
            return;
          }

          const draftId = await prepareForkDraft();
          const sourceDirectory =
            agent.projectPlacement?.checkout?.cwd?.trim() || agent.cwd.trim() || undefined;
          if (draftSetup) {
            useWorkspaceDraftSubmissionStore.getState().setDraftSetup({
              draftId,
              setup: draftSetup,
              sourceDirectory,
            });
          }
          router.push(
            buildNewWorkspaceRoute({
              serverId: resolvedServerId,
              sourceDirectory,
              displayName: agent.projectPlacement?.projectName,
              projectId: agent.projectPlacement?.projectKey,
              draftId,
            }),
          );
        } catch (error) {
          toast?.error(toErrorMessage(error) || t("message.actions.forkFailed"));
        }
      },
    );

    // Freeze stream data while this tab slot is hidden to prevent offscreen FlatList
    // cell-window renders on every 48ms flush from background agents.
    // When isActive flips back to true, the context change triggers a re-render and
    // the component reads the current (fresh) streamItems/streamHead from props.
    const isActive = useContext(MountedTabActiveContext);
    const frozenStreamItemsRef = useRef(streamItems);
    if (isActive) {
      frozenStreamItemsRef.current = streamItems;
    }
    const effectiveStreamItems = isActive ? streamItems : frozenStreamItemsRef.current;
    const effectiveAgentStatus =
      resolveForegroundAgentStatus(agent.status, agentThothState) ?? "idle";

    const baseRenderModel = useMemo(() => {
      return buildAgentStreamRenderModel({
        agentStatus: effectiveAgentStatus,
        tail: effectiveStreamItems,
        head: EMPTY_STREAM_HEAD,
        platform: isWeb ? "web" : "native",
        isMobileBreakpoint: isMobile,
      });
    }, [effectiveAgentStatus, isMobile, effectiveStreamItems]);
    const streamLayout = useMemo(
      () =>
        layoutStream({
          strategy: streamRenderStrategy,
          agentStatus: effectiveAgentStatus,
          history: baseRenderModel.history,
          liveHead: baseRenderModel.segments.liveHead,
          timingByAssistantId: baseRenderModel.turnTiming.byAssistantId,
        }),
      [
        effectiveAgentStatus,
        baseRenderModel.history,
        baseRenderModel.segments.liveHead,
        baseRenderModel.turnTiming.byAssistantId,
        streamRenderStrategy,
      ],
    );
    useImperativeHandle(
      ref,
      () => ({
        scrollToBottom(reason = "jump-to-bottom") {
          viewportRef.current?.scrollToBottom(reason);
        },
        prepareForViewportChange() {
          viewportRef.current?.prepareForViewportChange();
        },
      }),
      [],
    );

    const scrollToBottom = useCallback(() => {
      viewportRef.current?.scrollToBottom("jump-to-bottom");
    }, []);

    const setInlineDetailsExpanded = useCallback(
      (itemId: string, expanded: boolean) => {
        if (!streamRenderStrategy.shouldDisableParentScrollOnInlineDetailsExpansion()) {
          return;
        }
        setExpandedInlineToolCallIds((previous) => {
          const next = new Set(previous);
          if (expanded) {
            next.add(itemId);
          } else {
            next.delete(itemId);
          }
          return next;
        });
      },
      [streamRenderStrategy],
    );

    const renderUserMessage = useCallback(
      (
        messageId: string,
        text: string,
        timestamp: Date,
        presentation: PendingAgentMessage | undefined,
        layout: TimelineRenderLayout,
      ) => (
        <UserMessage
          serverId={resolvedServerId}
          agentId={agentId}
          messageId={messageId}
          message={text}
          images={presentation?.images}
          attachments={presentation?.attachments}
          timestamp={timestamp.getTime()}
          capabilities={agent.capabilities}
          client={client}
          isFirstInGroup={layout.isFirstInUserGroup}
          isLastInGroup={layout.isLastInUserGroup}
        />
      ),
      [agent.capabilities, agentId, client, resolvedServerId],
    );
    const renderContext = useMemo<Omit<TimelineRenderContext, "layout" | "agentIsRunning">>(
      () => ({
        renderPendingUser: (message, layout) =>
          renderUserMessage(message.messageId, message.text, message.timestamp, message, layout),
        renderUser: (entry, layout) =>
          renderUserMessage(
            entry.item.messageId ?? timelineId(entry),
            entry.item.text,
            new Date(entry.timestamp),
            entry.presentation,
            layout,
          ),
        renderAssistant: (entry, layout) => (
          <AssistantFileLinkResolverProvider
            client={client}
            serverId={resolvedServerId}
            workspaceRoot={workspaceRoot}
            onOpenWorkspaceFile={handleInlinePathPress}
            toast={toast}
          >
            <AssistantMessage
              message={entry.item.text}
              timestamp={new Date(entry.timestamp).getTime()}
              workspaceRoot={workspaceRoot}
              serverId={resolvedServerId}
              client={client}
              spacing={layout.assistantSpacing}
            />
          </AssistantFileLinkResolverProvider>
        ),
        renderReasoning: (entry, loading, layout) => (
          <ToolCallSlot
            itemId={timelineId(entry)}
            onInlineDetailsExpandedChangeByItemId={setInlineDetailsExpanded}
            toolName="thinking"
            args={entry.item.text}
            status={loading ? "executing" : "completed"}
            isLastInSequence={layout.isLastInToolSequence}
          />
        ),
        renderTool: (entry, layout) => (
          <ToolCallSlot
            itemId={timelineId(entry)}
            onInlineDetailsExpandedChangeByItemId={setInlineDetailsExpanded}
            toolName={entry.item.name}
            error={entry.item.error}
            status={entry.item.status}
            detail={entry.item.detail}
            cwd={agent.cwd}
            metadata={entry.item.metadata}
            isLastInSequence={layout.isLastInToolSequence}
            onOpenFilePath={handleToolCallOpenFile}
          />
        ),
        renderClarify: (entry) => (
          <ClarifyDecisionCard
            card={entry.item.card}
            onSubmit={(answer) => handleSubmitClarifyAnswer(entry.item.card.id, answer)}
          />
        ),
        renderTask: (entry) => (
          <ThothApprovalCard
            card={entry.item.card}
            kind="task"
            approvalMode={approvalMode}
            onSubmit={(answer) => handleSubmitClarifyAnswer(entry.item.card.id, answer)}
          />
        ),
        renderGoal: (entry) => (
          <ThothApprovalCard
            card={entry.item.card}
            kind="goal"
            approvalMode={approvalMode}
            onSubmit={(answer) => handleSubmitClarifyAnswer(entry.item.card.id, answer)}
          />
        ),
        renderRegisteredTask: (entry) => <RegisteredTaskCard task={entry.item.task} />,
        renderTodo: (entry) => <TodoListCard items={entry.item.items} />,
        renderError: (entry) => (
          <ActivityLog
            type="error"
            message={entry.item.message}
            timestamp={new Date(entry.timestamp).getTime()}
          />
        ),
        renderCompaction: (entry) => (
          <CompactionMarker
            status={entry.item.status}
            trigger={entry.item.trigger}
            preTokens={entry.item.preTokens}
          />
        ),
      }),
      [
        agent.cwd,
        approvalMode,
        client,
        handleInlinePathPress,
        handleSubmitClarifyAnswer,
        handleToolCallOpenFile,
        renderUserMessage,
        resolvedServerId,
        setInlineDetailsExpanded,
        toast,
        workspaceRoot,
      ],
    );
    const finalItemId =
      effectiveStreamItems.length > 0
        ? timelineId(effectiveStreamItems[effectiveStreamItems.length - 1]!)
        : null;
    const renderStreamItemContent = useCallback(
      (layoutItem: StreamLayoutItem) =>
        renderTimelineItem(layoutItem.item, {
          ...renderContext,
          layout: layoutItem,
          agentIsRunning:
            effectiveAgentStatus === "running" && timelineId(layoutItem.item) === finalItemId,
        }),
      [effectiveAgentStatus, finalItemId, renderContext],
    );

    const bottomTurnFooterHost = streamLayout.auxiliaryTurnFooter;

    const renderStreamItem = useCallback(
      (layoutItem: StreamLayoutItem) => {
        const content = renderStreamItemContent(layoutItem);
        return renderStreamItemWithTurnFooter({
          content,
          layoutItem,
          strategy: streamRenderStrategy,
          onForkAssistantTurn: handleForkAssistantTurn,
        });
      },
      [handleForkAssistantTurn, renderStreamItemContent, streamRenderStrategy],
    );

    const pendingPermissionItems = useMemo(
      () => Array.from(pendingPermissions.values()).filter((perm) => perm.agentId === agentId),
      [pendingPermissions, agentId],
    );

    const showRunningTurnFooter =
      shouldShowForegroundTurnSpinner(agentThothState, effectiveAgentStatus) ||
      baseRenderModel.turnTiming.isActive;
    const pendingPermissionsNode = useMemo(
      () =>
        renderPendingPermissionsNode({
          pendingPermissions: pendingPermissionItems,
          client,
        }),
      [client, pendingPermissionItems],
    );
    const turnFooterNode = useMemo(
      () =>
        showRunningTurnFooter || bottomTurnFooterHost ? (
          <TurnFooter
            isRunning={showRunningTurnFooter}
            inFlightTurnStartedAt={baseRenderModel.turnTiming.runningStartedAt}
            host={bottomTurnFooterHost}
            strategy={streamRenderStrategy}
            onForkAssistantTurn={handleForkAssistantTurn}
          />
        ) : null,
      [
        handleForkAssistantTurn,
        showRunningTurnFooter,
        baseRenderModel.turnTiming.runningStartedAt,
        bottomTurnFooterHost,
        streamRenderStrategy,
      ],
    );
    const renderModel = useMemo<AgentStreamRenderModel>(() => {
      return {
        ...baseRenderModel,
        boundary: baseRenderModel.boundary,
        auxiliary: {
          pendingPermissions: pendingPermissionsNode,
          turnFooter: turnFooterNode,
        },
      };
    }, [baseRenderModel, pendingPermissionsNode, turnFooterNode]);

    const emptyStateStyle = useMemo(() => [stylesheet.emptyState, stylesheet.contentWrapper], []);
    const listEmptyComponent = useMemo(
      () =>
        renderListEmptyComponent({
          renderModel,
          emptyStateStyle,
          emptyText: t("agentStream.empty"),
        }),
      [renderModel, emptyStateStyle, t],
    );

    const { boundary, auxiliary } = renderModel;

    const layoutHistoryItemById = useMemo(() => {
      const itemById = new Map<string, StreamLayoutItem>();
      for (const item of streamLayout.history) {
        itemById.set(timelineId(item.item), item);
      }
      return itemById;
    }, [streamLayout.history]);

    const layoutLiveHeadItemById = useMemo(() => {
      const itemById = new Map<string, StreamLayoutItem>();
      for (const item of streamLayout.liveHead) {
        itemById.set(timelineId(item.item), item);
      }
      return itemById;
    }, [streamLayout.liveHead]);

    const renderHistoryRow = useCallback(
      (item: TimelineRenderItem) =>
        renderHistoryStreamItem({
          item,
          layoutItemById: layoutHistoryItemById,
          renderStreamItem,
        }),
      [layoutHistoryItemById, renderStreamItem],
    );

    const renderHistoryVirtualizedRow = useCallback<
      StreamSegmentRenderers["renderHistoryVirtualizedRow"]
    >((item) => renderHistoryRow(item), [renderHistoryRow]);
    const renderHistoryMountedRow = useCallback<StreamSegmentRenderers["renderHistoryMountedRow"]>(
      (item) => renderHistoryRow(item),
      [renderHistoryRow],
    );
    // useStableEvent keeps the function reference stable across flushes.
    // layoutLiveHeadItemById and renderStreamItem are read from the ref at call time,
    // so the live-head render always uses the latest layout without causing renderers
    // to be a new object on every text-chunk flush.
    const renderLiveHeadRow: StreamSegmentRenderers["renderLiveHeadRow"] = useStableEvent(
      (item: TimelineRenderItem) =>
        renderLiveHeadStreamItem({
          item,
          layoutItemById: layoutLiveHeadItemById,
          renderStreamItem,
        }),
    );
    const renderLiveAuxiliary = useCallback<StreamSegmentRenderers["renderLiveAuxiliary"]>(() => {
      return renderLiveAuxiliaryNode({
        pendingPermissions: auxiliary.pendingPermissions,
        turnFooter: auxiliary.turnFooter,
      });
    }, [auxiliary.pendingPermissions, auxiliary.turnFooter]);

    const renderers = useMemo<StreamSegmentRenderers>(
      () => ({
        renderHistoryVirtualizedRow,
        renderHistoryMountedRow,
        renderLiveHeadRow,
        renderLiveAuxiliary,
      }),
      [
        renderHistoryVirtualizedRow,
        renderHistoryMountedRow,
        renderLiveHeadRow,
        renderLiveAuxiliary,
      ],
    );

    const streamScrollEnabled =
      !streamRenderStrategy.shouldDisableParentScrollOnInlineDetailsExpansion() ||
      expandedInlineToolCallIds.size === 0;

    return (
      <ToolCallSheetProvider>
        <View style={stylesheet.container}>
          <MessageOuterSpacingProvider disableOuterSpacing>
            {streamRenderStrategy.render({
              agentId,
              segments: renderModel.segments,
              boundary,
              renderers,
              listEmptyComponent,
              viewportRef,
              routeBottomAnchorRequest,
              isAuthoritativeHistoryReady,
              onNearBottomChange: setIsNearBottom,
              onNearHistoryStart: loadOlder,
              isLoadingOlderHistory: isLoadingOlder,
              hasOlderHistory: hasOlder,
              olderHistoryProgressKey: progressKey,
              scrollEnabled: streamScrollEnabled,
              listStyle: stylesheet.list,
              baseListContentContainerStyle: stylesheet.listContentContainer,
              forwardListContentContainerStyle: stylesheet.forwardListContentContainer,
            })}
          </MessageOuterSpacingProvider>
          {!isNearBottom && (
            <Animated.View
              style={stylesheet.scrollToBottomContainer}
              entering={scrollIndicatorFadeIn}
              exiting={scrollIndicatorFadeOut}
            >
              <View style={stylesheet.scrollToBottomInner}>
                <Pressable
                  style={stylesheet.scrollToBottomButton}
                  onPress={scrollToBottom}
                  accessibilityRole="button"
                  accessibilityLabel={t("agentStream.scrollToBottom")}
                  testID="scroll-to-bottom-button"
                >
                  <ChevronDown size={24} color={stylesheet.scrollToBottomIcon.color} />
                </Pressable>
              </View>
            </Animated.View>
          )}
        </View>
      </ToolCallSheetProvider>
    );
  },
);

function agentCapabilityFlagsEqual(
  left: AgentCapabilityFlags | undefined,
  right: AgentCapabilityFlags | undefined,
): boolean {
  return AGENT_CAPABILITY_FLAG_KEYS.every((key) => left?.[key] === right?.[key]);
}

function collectAgentProjectPlacementDiffs(
  left: AgentScreenAgent["projectPlacement"],
  right: AgentScreenAgent["projectPlacement"],
): string[] {
  const reasons: string[] = [];
  if (left?.checkout?.cwd !== right?.checkout?.cwd) {
    reasons.push("agent.projectPlacement.checkout.cwd");
  }
  if (left?.checkout?.isGit !== right?.checkout?.isGit) {
    reasons.push("agent.projectPlacement.checkout.isGit");
  }
  if (left?.projectName !== right?.projectName) {
    reasons.push("agent.projectPlacement.projectName");
  }
  if (left?.projectKey !== right?.projectKey) {
    reasons.push("agent.projectPlacement.projectKey");
  }
  return reasons;
}

function collectAgentSetupDiffs(left: AgentScreenAgent, right: AgentScreenAgent): string[] {
  const reasons: string[] = [];
  if (left.provider !== right.provider) reasons.push("agent.provider");
  if (left.currentModeId !== right.currentModeId) reasons.push("agent.currentModeId");
  if (left.model !== right.model) reasons.push("agent.model");
  if (left.thinkingOptionId !== right.thinkingOptionId) {
    reasons.push("agent.thinkingOptionId");
  }
  if (left.runtimeInfo?.modeId !== right.runtimeInfo?.modeId) {
    reasons.push("agent.runtimeInfo.modeId");
  }
  if (left.runtimeInfo?.model !== right.runtimeInfo?.model) {
    reasons.push("agent.runtimeInfo.model");
  }
  if (left.runtimeInfo?.thinkingOptionId !== right.runtimeInfo?.thinkingOptionId) {
    reasons.push("agent.runtimeInfo.thinkingOptionId");
  }
  if (left.features !== right.features) reasons.push("agent.features");
  return reasons;
}

function collectAgentScreenAgentDiffs(left: AgentScreenAgent, right: AgentScreenAgent): string[] {
  const reasons: string[] = [];
  if (left.serverId !== right.serverId) reasons.push("agent.serverId");
  if (left.id !== right.id) reasons.push("agent.id");
  if (left.workspaceId !== right.workspaceId) reasons.push("agent.workspaceId");
  if (left.status !== right.status) reasons.push("agent.status");
  if (left.cwd !== right.cwd) reasons.push("agent.cwd");
  if (!agentCapabilityFlagsEqual(left.capabilities, right.capabilities)) {
    reasons.push("agent.capabilities");
  }
  if (left.lastError !== right.lastError) reasons.push("agent.lastError");
  reasons.push(...collectAgentSetupDiffs(left, right));
  reasons.push(...collectAgentProjectPlacementDiffs(left.projectPlacement, right.projectPlacement));
  return reasons;
}

function bottomAnchorRouteRequestsEqual(
  left: BottomAnchorRouteRequest | null | undefined,
  right: BottomAnchorRouteRequest | null | undefined,
): boolean {
  return (
    left?.agentId === right?.agentId &&
    left?.reason === right?.reason &&
    left?.requestKey === right?.requestKey
  );
}

function agentStreamViewPropsEqual(
  left: AgentStreamViewProps,
  right: AgentStreamViewProps,
): boolean {
  const reasons: string[] = [];
  if (left.agentId !== right.agentId) reasons.push("agentId");
  if (left.serverId !== right.serverId) reasons.push("serverId");
  reasons.push(...collectAgentScreenAgentDiffs(left.agent, right.agent));
  if (left.streamItems !== right.streamItems) reasons.push("streamItems");
  if (left.pendingPermissions !== right.pendingPermissions) reasons.push("pendingPermissions");
  if (
    !bottomAnchorRouteRequestsEqual(left.routeBottomAnchorRequest, right.routeBottomAnchorRequest)
  ) {
    reasons.push("routeBottomAnchorRequest");
  }
  if (left.isAuthoritativeHistoryReady !== right.isAuthoritativeHistoryReady) {
    reasons.push("isAuthoritativeHistoryReady");
  }
  if (left.toast !== right.toast) reasons.push("toast");
  if (left.approvalMode !== right.approvalMode) reasons.push("approvalMode");
  if (left.onOpenWorkspaceFile !== right.onOpenWorkspaceFile) reasons.push("onOpenWorkspaceFile");
  if (left.onSubmitClarifyAnswer !== right.onSubmitClarifyAnswer) {
    reasons.push("onSubmitClarifyAnswer");
  }
  recordRenderProfileReasons(`AgentStreamView:${right.agentId}`, reasons);
  return reasons.length === 0;
}

export const AgentStreamView = memo(AgentStreamViewComponent, agentStreamViewPropsEqual);
AgentStreamView.displayName = "AgentStreamView";

interface ToolCallSlotProps extends Omit<
  ComponentProps<typeof ToolCall>,
  "onInlineDetailsExpandedChange"
> {
  itemId: string;
  onInlineDetailsExpandedChangeByItemId: (itemId: string, expanded: boolean) => void;
}

function ToolCallSlot({
  itemId,
  onInlineDetailsExpandedChangeByItemId,
  ...rest
}: ToolCallSlotProps) {
  const handleExpandedChange = useCallback(
    (expanded: boolean) => onInlineDetailsExpandedChangeByItemId(itemId, expanded),
    [onInlineDetailsExpandedChangeByItemId, itemId],
  );
  return <ToolCall {...rest} onInlineDetailsExpandedChange={handleExpandedChange} />;
}

const ThemedActivityIndicator = withUnistyles(ActivityIndicator);
const ThemedCheckIcon = withUnistyles(Check);
const ThemedXIcon = withUnistyles(X);

const primaryColorMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
});
const mutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const pressableStyle = ({
  pressed,
  hovered = false,
}: PressableStateCallbackType & { hovered?: boolean }) => [
  permissionStyles.optionButton,
  hovered ? permissionStyles.optionButtonHovered : null,
  pressed ? permissionStyles.optionButtonPressed : null,
];

interface PermissionActionButtonProps {
  action: AgentPermissionAction;
  isRespondingAction: boolean;
  isResponding: boolean;
  isPrimary: boolean;
  Icon: typeof ThemedCheckIcon;
  testID: string;
  onPress: (action: AgentPermissionAction) => void;
}

function PermissionActionButton({
  action,
  isRespondingAction,
  isResponding,
  isPrimary,
  Icon,
  testID,
  onPress,
}: PermissionActionButtonProps) {
  const handlePress = useCallback(() => onPress(action), [onPress, action]);
  const optionTextStyle = isPrimary ? optionTextPrimaryStyle : permissionStyles.optionText;
  const colorMapping = isPrimary ? primaryColorMapping : mutedColorMapping;
  return (
    <Pressable testID={testID} style={pressableStyle} onPress={handlePress} disabled={isResponding}>
      {isRespondingAction ? (
        <ThemedActivityIndicator size="small" uniProps={colorMapping} />
      ) : (
        <View style={permissionStyles.optionContent}>
          <Icon size={14} uniProps={colorMapping} />
          <Text style={optionTextStyle}>{action.label}</Text>
        </View>
      )}
    </Pressable>
  );
}

function PermissionRequestCard({
  permission,
  client,
}: {
  permission: PendingPermission;
  client: DaemonClient | null;
}) {
  const { t } = useTranslation();
  const isMobile = useIsCompactFormFactor();

  const { request } = permission;
  const isPlanRequest = request.kind === "plan";
  const title = isPlanRequest
    ? t("agentStream.permission.plan")
    : (request.title ?? request.name ?? t("agentStream.permission.required"));
  const description = request.description ?? "";
  const resolvedToolCallDetail = useMemo(
    () =>
      request.detail ?? {
        type: "unknown" as const,
        input: request.input ?? null,
        output: null,
      },
    [request.detail, request.input],
  );
  const resolvedActions = useMemo((): AgentPermissionAction[] => {
    if (request.kind === "question") {
      return [];
    }
    if (Array.isArray(request.actions) && request.actions.length > 0) {
      return request.actions;
    }
    return [
      {
        id: "reject",
        label: t("agentStream.permission.deny"),
        behavior: "deny",
        variant: "danger",
        intent: "dismiss",
      },
      {
        id: "accept",
        label: isPlanRequest
          ? t("agentStream.permission.implement")
          : t("agentStream.permission.accept"),
        behavior: "allow",
        variant: "primary",
      },
    ];
  }, [isPlanRequest, request, t]);

  const planMarkdown = useMemo(() => {
    if (!request) {
      return undefined;
    }
    const planFromMetadata =
      typeof request.metadata?.planText === "string" ? request.metadata.planText : undefined;
    if (planFromMetadata) {
      return planFromMetadata;
    }
    const candidate = request.input?.["plan"];
    if (typeof candidate === "string") {
      return candidate;
    }
    return undefined;
  }, [request]);

  const permissionMutation = useMutation({
    mutationFn: async (input: {
      agentId: string;
      requestId: string;
      response: AgentPermissionResponse;
    }) => {
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      return client.respondToPermissionAndWait(
        input.agentId,
        input.requestId,
        input.response,
        15000,
      );
    },
  });
  const {
    reset: resetPermissionMutation,
    mutateAsync: respondToPermission,
    isPending: isResponding,
  } = permissionMutation;

  const [respondingActionId, setRespondingActionId] = useState<string | null>(null);

  useEffect(() => {
    resetPermissionMutation();
    setRespondingActionId(null);
  }, [permission.request.id, resetPermissionMutation]);
  const handleResponse = useCallback(
    (response: AgentPermissionResponse) => {
      respondToPermission({
        agentId: permission.agentId,
        requestId: permission.request.id,
        response,
      }).catch((error) => {
        console.error("[PermissionRequestCard] Failed to respond to permission:", error);
      });
    },
    [permission.agentId, permission.request.id, respondToPermission],
  );
  const handleActionPress = useCallback(
    (action: AgentPermissionAction) => {
      setRespondingActionId(action.id);
      if (action.behavior === "allow") {
        handleResponse({
          behavior: "allow",
          selectedActionId: action.id,
        });
        return;
      }
      handleResponse({
        behavior: "deny",
        selectedActionId: action.id,
        message: "Denied by user",
      });
    },
    [handleResponse],
  );

  const optionsContainerStyle = useMemo(
    () => [
      permissionStyles.optionsContainer,
      !isMobile && permissionStyles.optionsContainerDesktop,
    ],
    [isMobile],
  );

  if (request.kind === "question") {
    return (
      <QuestionFormCard
        permission={permission}
        onRespond={handleResponse}
        isResponding={isResponding}
      />
    );
  }

  const footer = (
    <>
      <Text testID="permission-request-question" style={permissionStyles.question}>
        {t("agentStream.permission.question")}
      </Text>

      <View style={optionsContainerStyle}>
        {resolvedActions.map((action) => {
          const isPrimary = action.variant === "primary";
          const isRespondingAction = respondingActionId === action.id;
          const Icon = action.behavior === "allow" ? ThemedCheckIcon : ThemedXIcon;
          let testID: string;
          if (action.behavior === "deny") testID = "permission-request-deny";
          else if (action.id === "accept" || action.id === "implement")
            testID = "permission-request-accept";
          else testID = `permission-request-action-${action.id}`;

          return (
            <PermissionActionButton
              key={action.id}
              action={action}
              isRespondingAction={isRespondingAction}
              isResponding={isResponding}
              isPrimary={isPrimary}
              Icon={Icon}
              testID={testID}
              onPress={handleActionPress}
            />
          );
        })}
      </View>
    </>
  );

  if (isPlanRequest && planMarkdown) {
    return (
      <PlanCard
        title={title}
        description={description}
        text={planMarkdown}
        footer={footer}
        testID="permission-plan-card"
        disableOuterSpacing
      />
    );
  }

  return (
    <View style={permissionStyles.container}>
      <Text style={permissionStyles.title}>{title}</Text>

      {description ? <Text style={permissionStyles.description}>{description}</Text> : null}

      {planMarkdown ? (
        <PlanCard
          title={t("agentStream.permission.proposedPlan")}
          text={planMarkdown}
          testID="permission-plan-card"
          disableOuterSpacing
        />
      ) : null}

      {!isPlanRequest ? (
        <ToolCallDetailsContent detail={resolvedToolCallDetail} maxHeight={200} />
      ) : null}

      {footer}
    </View>
  );
}

const stylesheet = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  contentWrapper: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
    paddingHorizontal: theme.spacing[2],
  },
  listContentContainer: {
    paddingVertical: 0,
    flexGrow: 1,
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[4],
    },
  },
  forwardListContentContainer: {
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[4],
  },
  list: {
    flex: 1,
  },
  streamItemWrapper: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
    paddingHorizontal: theme.spacing[2],
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[12],
  },
  permissionsContainer: {
    gap: theme.spacing[2],
  },
  listHeaderContent: {
    gap: theme.spacing[3],
  },
  emptyStateText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  scrollToBottomContainer: {
    position: "absolute",
    bottom: 16,
    left: 0,
    right: 0,
    alignItems: "center",
    pointerEvents: "box-none",
  },
  scrollToBottomInner: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
    alignItems: "center",
  },
  scrollToBottomButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
    ...theme.shadow.sm,
  },
  scrollToBottomIcon: {
    color: theme.colors.foreground,
  },
}));

const permissionStyles = StyleSheet.create((theme) => ({
  container: {
    marginVertical: theme.spacing[3],
    padding: theme.spacing[3],
    borderRadius: theme.spacing[2],
    borderWidth: 1,
    gap: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
    borderColor: theme.colors.border,
  },
  title: {
    fontSize: theme.fontSize.base,
    lineHeight: 22,
    color: theme.colors.foreground,
  },
  description: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.foregroundMuted,
  },
  question: {
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
    marginBottom: theme.spacing[1],
    color: theme.colors.foregroundMuted,
  },
  optionsContainer: {
    gap: theme.spacing[2],
  },
  optionsContainerDesktop: {
    flexDirection: "row",
    justifyContent: "flex-start",
    alignItems: "center",
    width: "100%",
  },
  optionButton: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    borderWidth: theme.borderWidth[1],
    backgroundColor: theme.colors.surface1,
    borderColor: theme.colors.borderAccent,
  },
  optionButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  optionButtonPressed: {
    opacity: 0.9,
  },
  optionContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  optionText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  optionTextPrimary: {
    color: theme.colors.foreground,
  },
}));

const optionTextPrimaryStyle = [permissionStyles.optionText, permissionStyles.optionTextPrimary];

interface StreamItemWrapperProps {
  gapBelow: number;
  children: ReactNode;
}

function StreamItemWrapper({ gapBelow, children }: StreamItemWrapperProps) {
  const wrapperStyle = useMemo(
    () => [stylesheet.streamItemWrapper, { marginBottom: gapBelow }],
    [gapBelow],
  );
  return <View style={wrapperStyle}>{children}</View>;
}
