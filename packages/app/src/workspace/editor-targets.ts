export type EditorTargetId = string;

const KNOWN_EDITOR_TARGET_IDS: ReadonlySet<string> = new Set([
  "cursor",
  "trae",
  "kiro",
  "vscode",
  "vscode-insiders",
  "vscodium",
  "zed",
  "antigravity",
  "intellij-idea",
  "aqua",
  "clion",
  "datagrip",
  "dataspell",
  "goland",
  "phpstorm",
  "pycharm",
  "rider",
  "rubymine",
  "rustrover",
  "webstorm",
  "finder",
  "explorer",
  "file-manager",
]);

export function isKnownEditorTargetId(editorId: EditorTargetId): boolean {
  return KNOWN_EDITOR_TARGET_IDS.has(editorId);
}
