import { describe, expect, test } from "vitest";
import { FORGE_DEFINITIONS, resolveForgeRepository } from "./forge.js";

describe("forge repository resolution", () => {
  test.each([
    ["https://github.com/acme/widgets.git", "github", "PR"],
    ["git@gitlab.com:acme/platform/widgets.git", "gitlab", "MR"],
    ["https://gitea.com/acme/widgets", "gitea", "PR"],
    ["ssh://git@forgejo.example.com/acme/widgets.git", "forgejo", "PR"],
    ["https://codeberg.org/acme/widgets.git", "codeberg", "PR"],
  ] as const)("resolves %s", (remoteUrl, forge, changeRequestAbbrev) => {
    expect(resolveForgeRepository(remoteUrl)).toMatchObject({
      forge,
      namespace: forge === "gitlab" ? "acme/platform" : "acme",
      repository: "widgets",
      changeRequestAbbrev,
    });
  });

  test("requires an explicit hint for an unknown self-hosted forge", () => {
    expect(resolveForgeRepository("https://git.example.com/acme/widgets.git")).toBeNull();
    expect(
      resolveForgeRepository("https://git.example.com/acme/widgets.git", "forgejo"),
    ).toMatchObject({ forge: "forgejo", host: "git.example.com" });
  });

  test("keeps the supported portfolio declarative and complete", () => {
    expect(FORGE_DEFINITIONS.map((definition) => definition.id)).toEqual([
      "github",
      "gitlab",
      "gitea",
      "forgejo",
      "codeberg",
    ]);
  });
});
