export interface FileLineSelection {
  lineStart: number;
  lineEnd: number;
}

export function clampFileLineSelection(input: {
  lineStart?: number;
  lineEnd?: number;
  lineCount: number;
}): FileLineSelection | null {
  if (!input.lineStart || input.lineStart <= 0 || input.lineCount <= 0) return null;
  const lineStart = Math.min(Math.floor(input.lineStart), input.lineCount);
  const rawLineEnd =
    input.lineEnd && input.lineEnd >= input.lineStart ? input.lineEnd : input.lineStart;
  const lineEnd = Math.min(Math.floor(rawLineEnd), input.lineCount);
  return { lineStart, lineEnd: Math.max(lineStart, lineEnd) };
}

export function fileLineSelectionScrollOffset(
  selection: FileLineSelection,
  lineHeight: number,
): number {
  return Math.max(0, (selection.lineStart - 1) * lineHeight);
}
