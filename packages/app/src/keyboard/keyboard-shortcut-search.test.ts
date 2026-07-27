import { describe, expect, it } from "vitest";
import type { KeyboardShortcutHelpSection } from "./keyboard-shortcuts";
import { filterKeyboardShortcutHelpSections } from "./keyboard-shortcut-search";

const sections: KeyboardShortcutHelpSection[] = [
  {
    id: "navigation",
    title: "Navigation",
    titleKey: "section.navigation",
    rows: [
      {
        id: "command-center",
        label: "Command Center",
        labelKey: "action.commandCenter",
        keys: ["mod", "shift", "P"],
        note: "Open actions",
      },
    ],
  },
];

const labels: Record<string, string> = {
  "section.navigation": "Navigation",
  "action.commandCenter": "Command Center",
};
const translate = (key: string) => labels[key] ?? key;

describe("filterKeyboardShortcutHelpSections", () => {
  it("indexes translated labels, notes and formatted chords", () => {
    expect(
      filterKeyboardShortcutHelpSections({
        sections,
        query: "actions",
        shortcutOs: "mac",
        translate,
      }),
    ).toHaveLength(1);
    expect(
      filterKeyboardShortcutHelpSections({
        sections,
        query: "Shift+⌘+P",
        shortcutOs: "mac",
        translate,
      }),
    ).toHaveLength(1);
  });

  it("indexes cmd/command and alt/option aliases on macOS", () => {
    for (const query of ["cmd+shift+p", "command shift p"]) {
      expect(
        filterKeyboardShortcutHelpSections({ sections, query, shortcutOs: "mac", translate }),
      ).toHaveLength(1);
    }
  });

  it("returns no sections when no searchable field matches", () => {
    expect(
      filterKeyboardShortcutHelpSections({
        sections,
        query: "does-not-exist",
        shortcutOs: "mac",
        translate,
      }),
    ).toEqual([]);
  });
});
