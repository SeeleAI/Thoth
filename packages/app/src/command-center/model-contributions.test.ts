import { describe, expect, it } from "vitest";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";
import {
  buildModelChoiceContribution,
  filterCommandCenterModelChoices,
} from "./model-contributions";

function provider(input: {
  id: string;
  label: string;
  state: "models" | "error";
}): ProviderSelectorProvider {
  if (input.state === "error") {
    return {
      id: input.id,
      label: input.label,
      modelSelection: { kind: "error", message: "Unavailable" },
    };
  }
  return {
    id: input.id,
    label: input.label,
    modelSelection: {
      kind: "models",
      rows: [
        {
          favoriteKey: `${input.id}:model`,
          provider: input.id,
          providerLabel: input.label,
          modelId: "model",
          modelLabel: `${input.label} model`,
          description: undefined,
        },
      ],
    },
  };
}

describe("Command Center model choices", () => {
  it("publishes selectable providers and executes the focused draft owner", () => {
    const selections: string[] = [];
    const contribution = buildModelChoiceContribution({
      sourceId: "draft:host:one",
      providers: [
        provider({ id: "claude", label: "Claude", state: "models" }),
        provider({ id: "codex", label: "Codex", state: "models" }),
      ],
      selectedProvider: "codex",
      selectedModelId: "model",
      groupLabel: "Model",
      searchKeywords: "model switch",
      select: (providerId, modelId) => selections.push(`${providerId}:${modelId}`),
    });

    expect(
      contribution.choices.map((choice) => ({ id: choice.id, selected: choice.selected })),
    ).toEqual([
      { id: "draft:host:one:claude:model", selected: false },
      { id: "draft:host:one:codex:model", selected: true },
    ]);
    contribution.choices[0]?.run();
    contribution.choices[1]?.run();
    expect(selections).toEqual(["claude:model"]);
  });

  it("does not publish unavailable providers or no-op default rows", () => {
    const contribution = buildModelChoiceContribution({
      sourceId: "draft:host:one",
      providers: [
        provider({ id: "unavailable", label: "Unavailable", state: "error" }),
        {
          id: "empty",
          label: "Empty",
          modelSelection: {
            kind: "models",
            rows: [
              {
                favoriteKey: "empty:",
                provider: "empty",
                providerLabel: "Empty",
                modelId: "",
                modelLabel: "Default",
                description: undefined,
              },
            ],
          },
        },
      ],
      selectedProvider: null,
      selectedModelId: null,
      groupLabel: "Model",
      searchKeywords: "model switch",
      select: () => undefined,
    });

    expect(contribution.choices).toEqual([]);
  });

  it("keeps the default palette unchanged and query-gates model choices", () => {
    const contribution = buildModelChoiceContribution({
      sourceId: "agent:host:one",
      providers: [provider({ id: "claude", label: "Claude", state: "models" })],
      selectedProvider: "claude",
      selectedModelId: null,
      groupLabel: "Model",
      searchKeywords: "switch model",
      select: () => undefined,
    });

    expect(filterCommandCenterModelChoices([contribution], "")).toEqual([]);
    expect(filterCommandCenterModelChoices([contribution], "claude")).toHaveLength(1);
    expect(filterCommandCenterModelChoices([contribution], "switch model")).toHaveLength(1);
  });
});
