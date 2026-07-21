import { createHash } from "node:crypto";
import { loadRuntimeSkillArtifact } from "../clarify/contract.js";
import type { RuntimeBundle, RuntimeBundleTool } from "./types.js";

export interface RuntimeBundleCatalog {
  toolsFor(bundleId: RuntimeBundle["id"]): readonly RuntimeBundleTool[];
  scopesFor(bundleId: RuntimeBundle["id"]): readonly string[];
}

export function loadRuntimeBundle(
  id: RuntimeBundle["id"],
  catalog: RuntimeBundleCatalog,
): RuntimeBundle {
  const artifact = loadRuntimeSkillArtifact(id);
  const tools = catalog.toolsFor(id);
  const scopes = catalog.scopesFor(id);
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        id,
        instructions: artifact.body,
        tools,
        scopes,
      }),
    )
    .digest("hex");
  return {
    id,
    digest: `sha256:${digest}`,
    instructions: artifact.body,
    tools,
    scopes,
    sourceName: `${artifact.folderName}/SKILL.md`,
  };
}
