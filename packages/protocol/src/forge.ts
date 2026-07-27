import { z } from "zod";
import { normalizeHost, parseGitRemoteLocation } from "./git-remote.js";

export const ForgeIdSchema = z.enum(["github", "gitlab", "gitea", "forgejo", "codeberg"]);
export type ForgeId = z.infer<typeof ForgeIdSchema>;

export const ForgeDefinitionSchema = z.object({
  id: ForgeIdSchema,
  displayName: z.string(),
  changeRequestAbbrev: z.enum(["PR", "MR"]),
  changeRequestNoun: z.enum(["pull request", "merge request"]),
  changeRequestNumberPrefix: z.enum(["#", "!"]),
  iconKind: z.enum(["github", "gitlab", "gitea", "forgejo", "codeberg"]),
  cloudHosts: z.array(z.string()),
});
export type ForgeDefinition = z.infer<typeof ForgeDefinitionSchema>;

export const FORGE_DEFINITIONS: readonly ForgeDefinition[] = [
  {
    id: "github",
    displayName: "GitHub",
    changeRequestAbbrev: "PR",
    changeRequestNoun: "pull request",
    changeRequestNumberPrefix: "#",
    iconKind: "github",
    cloudHosts: ["github.com", "ssh.github.com"],
  },
  {
    id: "gitlab",
    displayName: "GitLab",
    changeRequestAbbrev: "MR",
    changeRequestNoun: "merge request",
    changeRequestNumberPrefix: "!",
    iconKind: "gitlab",
    cloudHosts: ["gitlab.com"],
  },
  {
    id: "gitea",
    displayName: "Gitea",
    changeRequestAbbrev: "PR",
    changeRequestNoun: "pull request",
    changeRequestNumberPrefix: "#",
    iconKind: "gitea",
    cloudHosts: ["gitea.com"],
  },
  {
    id: "forgejo",
    displayName: "Forgejo",
    changeRequestAbbrev: "PR",
    changeRequestNoun: "pull request",
    changeRequestNumberPrefix: "#",
    iconKind: "forgejo",
    cloudHosts: [],
  },
  {
    id: "codeberg",
    displayName: "Codeberg",
    changeRequestAbbrev: "PR",
    changeRequestNoun: "pull request",
    changeRequestNumberPrefix: "#",
    iconKind: "codeberg",
    cloudHosts: ["codeberg.org"],
  },
] as const;

export const ForgeRepositorySchema = z.object({
  forge: ForgeIdSchema,
  host: z.string().min(1),
  namespace: z.string().min(1),
  repository: z.string().min(1),
  fullName: z.string().min(1),
  remoteUrl: z.string().min(1),
  webUrl: z.url(),
  changeRequestAbbrev: z.enum(["PR", "MR"]),
  changeRequestNoun: z.enum(["pull request", "merge request"]),
});
export type ForgeRepository = z.infer<typeof ForgeRepositorySchema>;

export const ForgeResolveErrorCodeSchema = z.enum(["invalid_remote", "unsupported_forge"]);
export type ForgeResolveErrorCode = z.infer<typeof ForgeResolveErrorCodeSchema>;

export function getForgeDefinition(id: ForgeId): ForgeDefinition {
  return FORGE_DEFINITIONS.find((definition) => definition.id === id)!;
}

export function resolveForgeRepository(
  remoteUrl: string,
  forgeHint?: ForgeId,
): ForgeRepository | null {
  const location = parseGitRemoteLocation(remoteUrl);
  if (!location) return null;
  const segments = location.path.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  const repository = segments.at(-1)!;
  const namespace = segments.slice(0, -1).join("/");
  const forge = forgeHint ?? resolveForgeForHost(location.host);
  if (!forge) return null;
  const definition = getForgeDefinition(forge);
  return ForgeRepositorySchema.parse({
    forge,
    host: location.host,
    namespace,
    repository,
    fullName: `${namespace}/${repository}`,
    remoteUrl: remoteUrl.trim(),
    webUrl: `https://${location.host}/${namespace}/${repository}`,
    changeRequestAbbrev: definition.changeRequestAbbrev,
    changeRequestNoun: definition.changeRequestNoun,
  });
}

function resolveForgeForHost(hostValue: string): ForgeId | null {
  const host = normalizeHost(hostValue);
  for (const definition of FORGE_DEFINITIONS) {
    if (definition.cloudHosts.includes(host)) return definition.id;
  }
  const labels = host.split(/[.-]/u);
  if (labels.includes("gitlab")) return "gitlab";
  if (labels.includes("forgejo")) return "forgejo";
  if (labels.includes("gitea")) return "gitea";
  if (labels.includes("github")) return "github";
  return null;
}
