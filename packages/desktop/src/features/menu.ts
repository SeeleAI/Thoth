import { Menu, BrowserWindow, ipcMain } from "electron";
import { getActiveThothBrowserWebContentsForHostWindow } from "./browser-webviews/index.js";

interface ShowContextMenuInput {
  kind?: "terminal";
  hasSelection?: boolean;
}

export interface ApplicationMenuOptions {
  onNewWindow: () => void;
}

function withBrowserWindow(
  callback: (win: BrowserWindow) => void,
): (_item: Electron.MenuItem, baseWin: Electron.BaseWindow | undefined) => void {
  return (_item, baseWin) => {
    const win = baseWin instanceof BrowserWindow ? baseWin : BrowserWindow.getFocusedWindow();
    if (win) callback(win);
  };
}

function reloadFocusedContentsOrWindow(win: BrowserWindow, options?: { ignoreCache?: boolean }) {
  const browserContents = getActiveThothBrowserWebContentsForHostWindow(win.webContents.id);
  if (browserContents) {
    if (options?.ignoreCache) {
      browserContents.reloadIgnoringCache();
      return;
    }
    if (browserContents.isLoadingMainFrame()) {
      browserContents.stop();
      return;
    }
    browserContents.reload();
    return;
  }

  if (options?.ignoreCache) {
    win.webContents.reloadIgnoringCache();
    return;
  }
  win.webContents.reload();
}

export function buildApplicationMenuTemplate(
  options: ApplicationMenuOptions,
): Electron.MenuItemConstructorOptions[] {
  const isMac = process.platform === "darwin";
  const thothMenu: Electron.MenuItemConstructorOptions = {
    label: "Thoth",
    submenu: [
      { role: "about" as const },
      { type: "separator" as const },
      { label: "One Thoth Home", enabled: false },
      { label: "Settings / About", enabled: false },
      { type: "separator" as const },
      ...(isMac
        ? [
            { role: "services" as const },
            { type: "separator" as const },
            { role: "hide" as const },
            { role: "hideOthers" as const },
            { role: "unhide" as const },
            { type: "separator" as const },
          ]
        : []),
      { role: "quit" as const },
    ],
  };

  return [
    thothMenu,
    {
      label: "File",
      submenu: [
        {
          label: "New Window",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => {
            options.onNewWindow();
          },
        },
        { type: "separator" as const },
        { role: "undo" },
        { role: "redo" },
        { type: "separator" as const },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "Workspace",
      submenu: [
        { label: "Open Workspace...", enabled: false },
        { label: "Register Current Workspace", enabled: false },
        { label: "Workspace Settings", enabled: false },
        { type: "separator" as const },
        { label: "Context / Files", enabled: false },
        { label: "Evidence Preview", enabled: false },
      ],
    },
    {
      label: "Task",
      submenu: [
        { label: "New Quick Conversation", enabled: false },
        { label: "New Loop Task", enabled: false },
        { type: "separator" as const },
        { label: "Clarify Contract", enabled: false },
        { label: "Review Evidence", enabled: false },
        { label: "Stop Current Loop", enabled: false },
      ],
    },
    {
      label: "Provider",
      submenu: [
        { label: "Provider Settings", enabled: false },
        { label: "Refresh Provider Readiness", enabled: false },
        { type: "separator" as const },
        { label: "Select Model", enabled: false },
        { label: "Permission Mode", enabled: false },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Zoom In",
          accelerator: "CmdOrCtrl+=",
          click: withBrowserWindow((win) => {
            win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5);
          }),
        },
        {
          label: "Zoom Out",
          accelerator: "CmdOrCtrl+-",
          click: withBrowserWindow((win) => {
            win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5);
          }),
        },
        {
          label: "Actual Size",
          accelerator: "CmdOrCtrl+0",
          click: withBrowserWindow((win) => {
            win.webContents.setZoomLevel(0);
          }),
        },
        { type: "separator" },
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click: withBrowserWindow((win) => {
            reloadFocusedContentsOrWindow(win);
          }),
        },
        {
          label: "Force Reload",
          accelerator: "CmdOrCtrl+Shift+R",
          click: withBrowserWindow((win) => {
            reloadFocusedContentsOrWindow(win, { ignoreCache: true });
          }),
        },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [{ type: "separator" as const }, { role: "front" as const }]
          : [{ role: "close" as const }]),
      ],
    },
    {
      label: "Help",
      submenu: [
        { label: "Thoth Help", enabled: false },
        { label: "Recovery Guide", enabled: false },
        { label: "Report Diagnostics", enabled: false },
      ],
    },
  ];
}

export function setupApplicationMenu(options: ApplicationMenuOptions): void {
  const menu = Menu.buildFromTemplate(buildApplicationMenuTemplate(options));
  Menu.setApplicationMenu(menu);

  ipcMain.handle("thoth:menu:showContextMenu", (event, input?: ShowContextMenuInput) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return;
    }

    if (input?.kind !== "terminal") {
      return;
    }

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Copy",
        role: "copy",
        enabled: input.hasSelection === true,
      },
      {
        label: "Paste",
        role: "paste",
      },
      {
        type: "separator",
      },
      {
        label: "Select All",
        role: "selectAll",
      },
    ]);

    contextMenu.popup({ window: win });
  });
}
