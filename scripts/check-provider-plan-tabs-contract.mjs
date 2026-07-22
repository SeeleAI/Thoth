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
  "provider-run-mode-control",
  "updateAgentProviderControl",
  "getAgentProviderControl",
]) {
  if (!agentControls.includes(required)) failures.push(`Provider sheet is missing ${required}`);
}
if (agentControls.includes("snapshotSelectedEntry?.planCapability")) {
  failures.push("Existing Agent Plan capability still falls back to a provider snapshot");
}

const composer = read("packages/app/src/composer/index.tsx");
if (composer.includes("daemonConfig?.providerControl")) {
  failures.push("Composer still freezes Plan from global daemon config");
}

const workspaceScreen = read("packages/app/src/screens/workspace/workspace-screen.tsx");
const archiveIndex = workspaceScreen.indexOf(
  "await archiveAgent({ serverId: normalizedServerId, agentId })",
);
const cleanupIndex = workspaceScreen.indexOf(
  'closeWorkspaceTabWithCleanup({\n            tabId,\n            target: { kind: "agent", agentId },',
  archiveIndex,
);
if (archiveIndex < 0 || cleanupIndex <= archiveIndex) {
  failures.push("Top-level Agent tab is not archived before layout cleanup");
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
