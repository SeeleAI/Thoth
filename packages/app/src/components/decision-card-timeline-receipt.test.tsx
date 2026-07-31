/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DecisionCardTimelineReceipt } from "./decision-card-timeline-receipt";

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) =>
      typeof factory === "function"
        ? (factory as (theme: unknown) => unknown)({
            spacing: { 2: 8, 3: 12 },
            borderWidth: { 1: 1 },
            borderRadius: { md: 6 },
            fontSize: { xs: 11, sm: 13 },
            fontWeight: { medium: "500" },
            colors: {
              foreground: "#fff",
              foregroundMuted: "#999",
              surface1: "#181818",
              statusSuccess: "#4caf72",
              statusWarning: "#e1a23c",
              border: "#333",
            },
          })
        : factory,
  },
}));

vi.mock("lucide-react-native", () => ({
  Check: () => <span data-testid="recorded-icon" />,
  CircleHelp: () => <span data-testid="waiting-icon" />,
  X: () => <span data-testid="closed-icon" />,
}));

afterEach(cleanup);

describe("DecisionCardTimelineReceipt", () => {
  it("renders an active Card only as a pointer to the tree inspector", () => {
    render(
      <DecisionCardTimelineReceipt active summary={null} title="Choose the delivery boundary" />,
    );
    expect(screen.getByText("Waiting in the decision tree")).toBeTruthy();
    expect(screen.getByTestId("waiting-icon")).toBeTruthy();
  });

  it("renders a submitted Card as an immutable receipt", () => {
    render(
      <DecisionCardTimelineReceipt
        active={false}
        summary="Desktop delivery confirmed"
        title="Choose the delivery boundary"
      />,
    );
    expect(screen.getByText("Desktop delivery confirmed")).toBeTruthy();
    expect(screen.getByTestId("recorded-icon")).toBeTruthy();
  });

  it("distinguishes a canceled Card from a human decision", () => {
    render(
      <DecisionCardTimelineReceipt
        active={false}
        canceled
        summary="Clarify turn canceled"
        title="Choose the delivery boundary"
      />,
    );
    expect(screen.getByText("Clarify turn canceled")).toBeTruthy();
    expect(screen.getByTestId("closed-icon")).toBeTruthy();
  });
});
