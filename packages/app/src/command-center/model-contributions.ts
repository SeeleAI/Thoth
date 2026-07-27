import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";
import type { CommandCenterModelChoice, CommandCenterModelContribution } from "./model-registry";

export function buildModelChoiceContribution(input: {
  sourceId: string;
  providers: readonly ProviderSelectorProvider[];
  selectedProvider: string | null;
  selectedModelId: string | null;
  groupLabel: string;
  searchKeywords: string;
  select: (providerId: string, modelId: string) => void;
}): CommandCenterModelContribution {
  const choices: CommandCenterModelChoice[] = [];
  for (const provider of input.providers) {
    if (provider.modelSelection.kind !== "models") {
      continue;
    }
    for (const model of provider.modelSelection.rows) {
      if (!model.modelId) {
        continue;
      }
      const selected =
        input.selectedProvider === provider.id && input.selectedModelId === model.modelId;
      const providerId = provider.id;
      const modelId = model.modelId;
      choices.push({
        id: `${input.sourceId}:${providerId}:${modelId}`,
        providerId,
        providerLabel: provider.label,
        modelId,
        modelLabel: model.modelLabel,
        selected,
        keywords: [
          input.groupLabel,
          input.searchKeywords,
          provider.label,
          providerId,
          model.modelLabel,
          modelId,
          model.description ?? "",
        ],
        run: () => {
          if (!selected) {
            input.select(providerId, modelId);
          }
        },
      });
    }
  }
  return { sourceId: input.sourceId, choices };
}

export function filterCommandCenterModelChoices(
  contributions: readonly CommandCenterModelContribution[],
  query: string,
): CommandCenterModelChoice[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) {
    return [];
  }

  const matches = new Map<string, CommandCenterModelChoice>();
  for (const contribution of contributions) {
    for (const choice of contribution.choices) {
      const searchText = [
        choice.modelLabel,
        choice.modelId,
        choice.providerLabel,
        ...choice.keywords,
      ]
        .join(" ")
        .toLocaleLowerCase();
      if (searchText.includes(normalized)) {
        matches.set(choice.id, choice);
      }
    }
  }
  return Array.from(matches.values());
}
