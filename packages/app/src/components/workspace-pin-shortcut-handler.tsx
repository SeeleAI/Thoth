import { useGlobalWorkspacePinAction } from "@/hooks/use-global-workspace-pin-action";

export function WorkspacePinShortcutHandler() {
  useGlobalWorkspacePinAction();
  return null;
}
