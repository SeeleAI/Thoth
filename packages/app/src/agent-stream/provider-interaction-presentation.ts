import type { AgentPermissionRequest } from "@thoth/protocol/agent-types";

export function isDaemonProviderPlanPermission(request: AgentPermissionRequest): boolean {
  return (
    request.kind === "plan" &&
    request.metadata?.owner === "thoth-daemon" &&
    request.metadata.authority === "provider-plan"
  );
}

export function filterVisibleProviderPermissions<T extends { request: AgentPermissionRequest }>(
  permissions: readonly T[],
  hasPendingProviderQuestion: boolean,
): T[] {
  return permissions.filter((permission) => {
    if (permission.request.kind !== "plan") return true;
    return !hasPendingProviderQuestion && isDaemonProviderPlanPermission(permission.request);
  });
}
