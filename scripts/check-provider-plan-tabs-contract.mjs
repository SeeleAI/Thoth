import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (path) => readFileSync(resolve(root, path), "utf8");
const failures = [];

const runtimeControls = read("packages/app/src/composer/agent-controls/runtime-controls.tsx");
if (
  runtimeControls.includes("provider-plan-switch") ||
  runtimeControls.includes("providerControl")
) {
  failures.push("Composer runtime controls still own provider Plan state");
}

const agentControls = read("packages/app/src/composer/agent-controls/index.tsx");
for (const required of [
  "provider-plan-feature",
  "Provider Features",
  'onSelectRunMode(enabled ? "default" : "plan")',
  "updateAgentProviderControl",
  "getAgentProviderControl",
]) {
  if (!agentControls.includes(required)) failures.push(`Provider sheet is missing ${required}`);
}
const providerFeaturesIndex = agentControls.indexOf(">Provider Features</Text>");
const providerPlanFeatureIndex = agentControls.indexOf(
  "<ProviderPlanFeatureItem",
  providerFeaturesIndex,
);
const nativeProviderFeaturesIndex = agentControls.indexOf(
  "(features ?? []).map",
  providerPlanFeatureIndex,
);
if (
  providerFeaturesIndex < 0 ||
  providerPlanFeatureIndex <= providerFeaturesIndex ||
  nativeProviderFeaturesIndex <= providerPlanFeatureIndex
) {
  failures.push("Provider Plan is not the first row inside Provider Features");
}
if (agentControls.includes("provider-run-mode-control") || agentControls.includes(">Run Mode<")) {
  failures.push("Provider Plan is still rendered as a separate Run Mode control");
}
if (agentControls.includes("snapshotSelectedEntry?.planCapability")) {
  failures.push("Existing Agent Plan capability still falls back to a provider snapshot");
}

const composer = read("packages/app/src/composer/index.tsx");
if (composer.includes("daemonConfig?.providerControl")) {
  failures.push("Composer still freezes Plan from global daemon config");
}

const codexAdapter = read("packages/drivers/src/server/agent/providers/codex-app-server-agent.ts");
for (const forbidden of [
  "emitSyntheticPlanApprovalRequest",
  "CodexPlanApproval",
  "preparePlanImplementation",
  "latestPlanResult",
]) {
  if (codexAdapter.includes(forbidden)) {
    failures.push(`Codex still owns removed Plan authority path ${forbidden}`);
  }
}
for (const required of [
  'type: "provider_plan_completed"',
  'type: "provider_question_requested"',
  'type: "skill"',
  "THOTH_RUNTIME_BUNDLE_CATALOG",
]) {
  if (!codexAdapter.includes(required)) {
    failures.push(`Codex native Plan bridge is missing ${required}`);
  }
}

const executionService = read("packages/daemon/src/server/agent/execution-service.ts");
for (const required of [
  "PROVIDER_PLAN_AUTHORITY_INVALID",
  "openDaemonPlanApproval",
  "resolveDaemonPlanApproval",
]) {
  if (!executionService.includes(required)) {
    failures.push(`Daemon Plan authority is missing ${required}`);
  }
}
for (const forbidden of ["planParts", "plan_ready"]) {
  if (executionService.includes(forbidden)) {
    failures.push(`ExecutionService still owns removed Plan synthesis ${forbidden}`);
  }
}

const foregroundCoordinator = read(
  "packages/daemon/src/server/agent/foreground-turn-coordinator.ts",
);
if (!foregroundCoordinator.includes("providerTurnId: event.providerTurnId")) {
  failures.push("Plan terminal transition does not use the native Provider turn identity");
}
if (foregroundCoordinator.includes("event.turnId ?? current.providerInteraction.providerTurnId")) {
  failures.push("Daemon lifecycle turn id can still masquerade as a native Provider turn id");
}

const daemonClient = read("packages/client/src/daemon-client.ts");
if (!daemonClient.includes("respondProviderQuestion")) {
  failures.push("Client is missing the typed Provider-question semantic API");
}

const agentStream = read("packages/app/src/agent-stream/view.tsx");
for (const required of ["pendingProviderQuestions", "QuestionFormCard"]) {
  if (!agentStream.includes(required)) {
    failures.push(`App Provider-question presentation is missing ${required}`);
  }
}

const workspaceScreen = read("packages/app/src/screens/workspace/workspace-screen.tsx");
const closeTabPolicy = read("packages/app/src/subagents/close-tab-policy.ts");
const agentVisibility = read("packages/app/src/workspace-tabs/agent-visibility.ts");
const bulkClose = read("packages/app/src/screens/workspace/workspace-bulk-close.ts");
const archiveIndex = closeTabPolicy.indexOf("await input.archive();");
const cleanupIndex = closeTabPolicy.indexOf("input.closeLayout();", archiveIndex);
if (
  !workspaceScreen.includes("await executeCloseAgentTab({") ||
  !workspaceScreen.includes(
    "archive: () => archiveAgent({ serverId: normalizedServerId, agentId })",
  ) ||
  !closeTabPolicy.includes("if (!agent || agent.archivedAt || agent.parentAgentId)") ||
  archiveIndex < 0 ||
  cleanupIndex <= archiveIndex
) {
  failures.push("Top-level Agent tab is not archived before layout cleanup");
}
for (const required of [
  "tabs: persistedUiTabs",
  "knownAgentIds: workspaceAgentVisibility.knownAgentIds",
  "archivedAgentIds: workspaceAgentVisibility.archivedAgentIds",
  "knownTerminalIds: knownTerminalIdSet",
]) {
  if (!workspaceScreen.includes(required)) {
    failures.push(`Workspace tab presentation is missing authority input: ${required}`);
  }
}
for (const required of [
  "knownAgentIds.has(tab.target.agentId) && !archivedAgentIds.has(tab.target.agentId)",
  "knownTerminalIds.has(tab.target.terminalId)",
]) {
  if (!agentVisibility.includes(required)) {
    failures.push(`Workspace entity tab selector is missing ${required}`);
  }
}
if (
  !bulkClose.includes("resolveCloseAgentTabPolicy(agent)") ||
  !bulkClose.includes("input.knownTerminalIds.has(tab.target.terminalId)")
) {
  failures.push("Bulk tab close does not revalidate current Agent and Terminal authority");
}

const workflow = read(".github/workflows/mvp-beta-release.yml");
if (/^  android-apk:/mu.test(workflow)) failures.push("Release workflow still has Android job");
if (workflow.includes("downloaded/android") || workflow.includes("downloaded/server")) {
  failures.push("Publish job still downloads non-desktop release artifacts");
}
for (const required of [
  "server-cli-smoke:",
  "relay-smoke:",
  "desktop-macos:",
  "desktop-linux:",
  "desktop-windows:",
]) {
  if (!workflow.includes(required)) failures.push(`Release gate is missing ${required}`);
}

const settings = read("packages/app/src/screens/settings-screen.tsx");
if (settings.includes("AndroidAppUpdateRow") || settings.includes("android-mvp-updater")) {
  failures.push("Android self-update UI is still reachable");
}
const appConfig = read("packages/app/app.config.js");
if (appConfig.includes("android.permission.REQUEST_INSTALL_PACKAGES")) {
  failures.push("Android package install permission is still requested");
}

if (failures.length > 0) {
  throw new Error(failures.join("\n"));
}
console.log("Provider Plan, tab archive, and desktop Release contract verified.");
