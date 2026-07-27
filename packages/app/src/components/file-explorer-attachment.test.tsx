/**
 * @vitest-environment jsdom
 */
import React, { act, forwardRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { client, toast, explorerState } = vi.hoisted(() => ({
  client: {
    readFile: vi.fn(async () => ({
      kind: "text" as const,
      bytes: new TextEncoder().encode("export const answer = 42;\n"),
      size: 26,
      modifiedAt: "2026-07-27T00:00:00Z",
    })),
  },
  toast: { show: vi.fn(), error: vi.fn() },
  explorerState: {
    directories: new Map([
      [
        ".",
        {
          path: ".",
          entries: [
            {
              name: "a.ts",
              path: "src/a.ts",
              kind: "file" as const,
              size: 26,
              modifiedAt: "2026-07-27T00:00:00Z",
            },
          ],
        },
      ],
    ]),
    files: new Map(),
    isLoading: false,
    lastError: null,
    pendingRequest: null,
    currentPath: ".",
    history: ["."],
    lastVisitedPath: ".",
    selectedEntryPath: null,
  },
}));

vi.mock("react-native", () => ({
  Platform: {
    OS: "web",
    select: (values: Record<string, unknown>) => values.web ?? values.default,
  },
  View: forwardRef(
    (
      { children, testID }: { children?: React.ReactNode; testID?: string },
      ref: React.ForwardedRef<HTMLDivElement>,
    ) => React.createElement("div", { ref, "data-testid": testID }, children),
  ),
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("span", null, children),
  Pressable: forwardRef(
    (
      {
        children,
        onPress,
        disabled,
        testID,
        accessibilityLabel,
      }: {
        children?:
          | React.ReactNode
          | ((state: { pressed: boolean; hovered: boolean }) => React.ReactNode);
        onPress?: () => void;
        disabled?: boolean;
        testID?: string;
        accessibilityLabel?: string;
      },
      ref: React.ForwardedRef<HTMLButtonElement>,
    ) =>
      React.createElement(
        "button",
        {
          ref,
          type: "button",
          disabled,
          "data-testid": testID,
          "aria-label": accessibilityLabel,
          onClick: onPress,
        },
        typeof children === "function" ? children({ pressed: false, hovered: false }) : children,
      ),
  ),
  FlatList: forwardRef(
    (
      {
        data,
        renderItem,
        keyExtractor,
        testID,
      }: {
        data: unknown[];
        renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
        keyExtractor: (item: unknown) => string;
        testID?: string;
      },
      ref: React.ForwardedRef<HTMLDivElement>,
    ) =>
      React.createElement(
        "div",
        { ref, "data-testid": testID },
        data.map((item, index) =>
          React.createElement(
            React.Fragment,
            { key: keyExtractor(item) },
            renderItem({ item, index }),
          ),
        ),
      ),
  ),
  ActivityIndicator: () => React.createElement("span", null, "loading"),
  Image: () => React.createElement("img"),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) =>
      typeof factory === "function"
        ? (factory as (theme: unknown) => unknown)({
            spacing: { 1: 4, 2: 8, 3: 12, 4: 16 },
            iconSize: { sm: 14 },
            colors: {
              foreground: "#fff",
              foregroundMuted: "#aaa",
              border: "#333",
              borderAccent: "#444",
              surface1: "#111",
              surface2: "#222",
              surface3: "#333",
              accent: "#09f",
              destructive: "#f00",
              surfaceSidebar: "#111",
              surfaceSidebarHover: "#222",
            },
            borderRadius: { base: 6, md: 8, full: 999 },
            borderWidth: { 1: 1 },
            fontSize: { xs: 11, sm: 13, base: 15 },
            fontWeight: { semibold: "600" },
          })
        : factory,
  },
  useUnistyles: () => ({
    theme: {
      spacing: { 2: 8 },
      iconSize: { sm: 14 },
      colors: { foregroundMuted: "#aaa" },
    },
  }),
  withUnistyles: (Component: React.ComponentType<unknown>) => Component,
}));

vi.mock("lucide-react-native", () => {
  const icon = (name: string) => () => React.createElement("span", { "data-icon": name });
  return {
    ChevronDown: icon("ChevronDown"),
    ChevronRight: icon("ChevronRight"),
    CircleDot: icon("CircleDot"),
    Copy: icon("Copy"),
    Download: icon("Download"),
    Eye: icon("Eye"),
    EyeOff: icon("EyeOff"),
    FileText: icon("FileText"),
    GitPullRequest: icon("GitPullRequest"),
    MessageSquareCode: icon("MessageSquareCode"),
    MessageSquarePlus: icon("MessageSquarePlus"),
    MoreVertical: icon("MoreVertical"),
    MousePointer2: icon("MousePointer2"),
    RotateCw: icon("RotateCw"),
    X: icon("X"),
  };
});

vi.mock("react-native-svg", () => ({
  SvgXml: () => React.createElement("span", { "data-testid": "file-icon" }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) =>
    queryKey[0] === "file-explorer"
      ? { data: explorerState }
      : { refetch: vi.fn(async () => ({ data: true })), isFetching: false },
}));

vi.mock("@/constants/layout", () => ({
  WORKSPACE_SECONDARY_HEADER_HEIGHT: 40,
  useIsCompactFormFactor: () => false,
}));

vi.mock("@/constants/platform", () => ({ isWeb: true, isNative: false }));
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn(async () => undefined) }));
vi.mock("@/components/material-file-icons", () => ({ getFileIconSvg: () => "<svg />" }));
vi.mock("@/components/ui/loading-spinner", () => ({ LoadingSpinner: () => null }));
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => [{ serverId: "server-1" }],
  useHostRuntimeClient: () => client,
}));
vi.mock("@/stores/download-store", () => ({
  useDownloadStore: (selector: (state: unknown) => unknown) => selector({ startDownload: vi.fn() }),
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  DropdownMenuTrigger: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("span", null, children),
  DropdownMenuContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children?: React.ReactNode;
    onSelect?: () => void;
  }) => React.createElement("button", { type: "button", onClick: onSelect }, children),
  DropdownMenuSeparator: () => null,
}));
vi.mock("@/hooks/use-file-explorer-actions", () => ({
  buildWorkspaceExplorerStateKey: ({ workspaceId }: { workspaceId?: string }) =>
    workspaceId ? `workspace:${workspaceId}` : null,
  emptyFileExplorerState: () => explorerState,
  fileExplorerQueryKey: (serverId: string, workspaceStateKey: string) => [
    "file-explorer",
    serverId,
    workspaceStateKey,
  ],
  useFileExplorerActions: () => ({
    requestDirectoryListing: vi.fn(async () => true),
    requestFileDownloadToken: vi.fn(),
    selectExplorerEntry: vi.fn(),
  }),
}));
vi.mock("@/stores/panel-store", () => {
  const state = {
    explorerSortOption: "name",
    explorerShowHiddenFiles: true,
    expandedPathsByWorkspace: {},
    setExplorerSortOption: vi.fn(),
    toggleExplorerShowHiddenFiles: vi.fn(),
    setExpandedPathsForWorkspace: vi.fn(),
  };
  const usePanelStore = (selector: (value: typeof state) => unknown) => selector(state);
  usePanelStore.getState = () => state;
  return { usePanelStore };
});
vi.mock("@/utils/time", () => ({ formatTimeAgo: () => "now" }));
vi.mock("@/file-explorer/visibility", () => ({
  filterVisibleExplorerEntries: (entries: unknown[]) => entries,
  isHiddenExplorerPath: () => false,
}));
vi.mock("@/components/use-web-scrollbar", () => ({
  useWebScrollViewScrollbar: () => ({
    onLayout: vi.fn(),
    onScroll: vi.fn(),
    onContentSizeChange: vi.fn(),
    overlay: null,
  }),
}));
vi.mock("@/contexts/toast-context", () => ({ useToast: () => toast }));
vi.mock("@/review/store", () => ({ useClearReviewDraft: () => vi.fn() }));

import { FileExplorerPane } from "./file-explorer-pane";
import {
  buildWorkspaceAttachmentScopeKey,
  resetWorkspaceAttachmentsStore,
  useWorkspaceAttachments,
} from "@/attachments/workspace-attachments-store";
import { composerWorkspaceAttachment } from "@/composer/attachments/workspace";

const scopeKey = buildWorkspaceAttachmentScopeKey({
  serverId: "server-1",
  workspaceId: "workspace-1",
  cwd: "/repo",
});

function ComposerPills() {
  const attachments = useWorkspaceAttachments(scopeKey);
  return (
    <div data-testid="composer-pills">
      {attachments.map((attachment, index) =>
        composerWorkspaceAttachment.renderPill({
          attachment,
          index,
          disabled: false,
          onOpen: () => {},
          onRemove: () => {},
        }),
      )}
    </div>
  );
}

describe("File Explorer to Composer attachment journey", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetWorkspaceAttachmentsStore();
    client.readFile.mockClear();
    toast.show.mockClear();
    toast.error.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("adds a daemon-read file and renders the real Workspace file Composer pill", async () => {
    await act(async () => {
      root.render(
        <>
          <FileExplorerPane serverId="server-1" workspaceId="workspace-1" workspaceRoot="/repo" />
          <ComposerPills />
        </>,
      );
    });

    const attachButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "workspace.fileExplorer.context.attachToComposer",
    );
    expect(attachButton).toBeDefined();
    await act(async () => {
      attachButton?.click();
      await Promise.resolve();
    });

    expect(client.readFile).toHaveBeenCalledWith("/repo", "src/a.ts");
    const pill = container.querySelector('[data-testid="composer-workspace-file-attachment-pill"]');
    expect(pill?.textContent).toContain("src/a.ts");
    expect(toast.show).toHaveBeenCalledWith("workspace.fileExplorer.context.attachedToComposer");
  });
});
