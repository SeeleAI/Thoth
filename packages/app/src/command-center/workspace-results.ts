import { buildHostWorkspaceRoute } from "@/utils/host-routes";

export interface CommandCenterWorkspaceSource {
  serverId: string;
  serverLabel: string;
  workspaceId: string;
  title: string;
  projectName: string;
  branch: string | null;
  workspaceDirectory: string;
}

export interface CommandCenterWorkspaceItem extends CommandCenterWorkspaceSource {
  id: string;
  subtitle: string;
  route: ReturnType<typeof buildHostWorkspaceRoute>;
}

export function joinCommandCenterSubtitleParts(
  parts: readonly (string | null | undefined)[],
): string {
  return parts.filter((part): part is string => Boolean(part?.trim())).join(" · ");
}

export function projectCommandCenterWorkspaceItems(input: {
  workspaces: readonly CommandCenterWorkspaceSource[];
  query: string;
  showHost: boolean;
}): CommandCenterWorkspaceItem[] {
  const query = input.query.trim().toLowerCase();
  return input.workspaces
    .map((workspace) => {
      const subtitle = joinCommandCenterSubtitleParts([
        input.showHost ? workspace.serverLabel : null,
        workspace.projectName,
        workspace.branch,
      ]);
      return {
        ...workspace,
        id: `workspace:${workspace.serverId}:${workspace.workspaceId}`,
        subtitle,
        route: buildHostWorkspaceRoute(workspace.serverId, workspace.workspaceId),
      };
    })
    .filter((workspace) => {
      if (!query) return true;
      return [
        workspace.title,
        workspace.projectName,
        workspace.branch,
        workspace.serverLabel,
        workspace.workspaceDirectory,
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(query));
    })
    .toSorted(
      (left, right) =>
        left.projectName.localeCompare(right.projectName, undefined, {
          numeric: true,
          sensitivity: "base",
        }) ||
        left.title.localeCompare(right.title, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
    );
}
