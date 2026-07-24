import { router } from "expo-router";
import { appProjectionRuntime } from "@/projection/projection-context";
import {
  redirectIfArchivingActiveWorkspace as redirectIfArchivingActiveWorkspacePure,
  type RedirectIfArchivingActiveWorkspaceInput,
} from "@/utils/workspace-archive-redirect";

export function redirectIfArchivingActiveWorkspace(
  input: RedirectIfArchivingActiveWorkspaceInput,
): boolean {
  return redirectIfArchivingActiveWorkspacePure(input, {
    navigateToRoute: (route) => router.replace(route),
    readWorkspaces: (serverId) =>
      appProjectionRuntime.store.getSnapshot(serverId).workspaces.values(),
  });
}
