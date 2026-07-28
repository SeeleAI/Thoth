import { useCallback } from "react";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { useWorkspace } from "@/projection/hooks";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useSidebarWorkspacePinsStore } from "@/stores/sidebar-workspace-pins-store";

const WORKSPACE_PIN_ACTIONS = ["workspace.pin"] as const;

export function useGlobalWorkspacePinAction() {
  const selection = useActiveWorkspaceSelection();
  const serverId = selection?.serverId ?? null;
  const routeWorkspaceId = selection?.workspaceId ?? null;
  const workspace = useWorkspace(serverId, routeWorkspaceId);
  const toggle = useSidebarWorkspacePinsStore((state) => state.toggle);

  const handle = useCallback(() => {
    if (!serverId || !workspace) return false;
    toggle(`${serverId}:${workspace.id}`);
    return true;
  }, [serverId, toggle, workspace]);

  useKeyboardActionHandler({
    handlerId: "workspace-pin-global",
    actions: WORKSPACE_PIN_ACTIONS,
    enabled: serverId !== null && workspace !== null,
    priority: 0,
    handle,
  });
}
