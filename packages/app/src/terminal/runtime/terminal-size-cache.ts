export interface TerminalViewportSize {
  rows: number;
  cols: number;
}

const sizeByWorkspace = new Map<string, TerminalViewportSize>();
let mostRecentSize: TerminalViewportSize | null = null;

function key(input: { serverId: string; workspaceId: string; cwd: string }): string {
  return JSON.stringify([input.serverId, input.workspaceId, input.cwd]);
}

export function rememberTerminalViewportSize(input: {
  serverId: string;
  workspaceId: string;
  cwd: string;
  size: TerminalViewportSize;
}): void {
  const size = { rows: input.size.rows, cols: input.size.cols };
  sizeByWorkspace.set(key(input), size);
  mostRecentSize = size;
}

export function estimateTerminalViewportSize(input: {
  serverId: string;
  workspaceId: string;
  cwd: string;
}): TerminalViewportSize | null {
  return sizeByWorkspace.get(key(input)) ?? mostRecentSize;
}

export function resetTerminalViewportSizeCacheForTests(): void {
  sizeByWorkspace.clear();
  mostRecentSize = null;
}
