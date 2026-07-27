import type { KeyboardShortcutHelpSection } from "./keyboard-shortcuts";
import { formatShortcut, type ShortcutOs } from "@/utils/format-shortcut";

function shortcutSearchAliases(keys: string[], shortcutOs: ShortcutOs): string {
  const aliases = keys.map((key) => {
    if (shortcutOs === "mac") {
      if (key === "mod" || key === "meta") return ["cmd", "command"];
      if (key === "alt") return ["alt", "option"];
    } else {
      if (key === "mod" || key === "ctrl") return ["ctrl", "control"];
      if (key === "meta") return ["win", "windows"];
    }
    return [key];
  });
  const combinations = aliases.reduce<string[][]>(
    (prefixes, choices) =>
      prefixes.flatMap((prefix) => choices.map((choice) => [...prefix, choice])),
    [[]],
  );
  return combinations
    .flatMap((combination) => [combination.join(" "), combination.join("+")])
    .join(" ");
}

export function filterKeyboardShortcutHelpSections(input: {
  sections: KeyboardShortcutHelpSection[];
  query: string;
  shortcutOs: ShortcutOs;
  translate: (key: string) => string;
}): KeyboardShortcutHelpSection[] {
  const normalizedQuery = input.query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return input.sections;
  }

  return input.sections.flatMap((section) => {
    const sectionTitle = input.translate(section.titleKey);
    if (sectionTitle.toLocaleLowerCase().includes(normalizedQuery)) {
      return [section];
    }

    const rows = section.rows.filter((row) => {
      const searchText = [
        input.translate(row.labelKey),
        row.noteKey ? input.translate(row.noteKey) : row.note,
        row.keys.join(" "),
        formatShortcut(row.keys, input.shortcutOs),
        shortcutSearchAliases(row.keys, input.shortcutOs),
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      return searchText.includes(normalizedQuery);
    });

    return rows.length > 0 ? [{ ...section, rows }] : [];
  });
}
