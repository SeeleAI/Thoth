import { expect, test } from "./fixtures";
import { expectComposerVisible, submitMessage } from "./helpers/composer";
import { openAgentRoute } from "./helpers/mock-agent";
import { allowPermission } from "./helpers/permissions";
import {
  chooseQuestionOption,
  submitQuestionAnswers,
  waitForQuestionPrompt,
} from "./helpers/questions";
import { seedWorkspace } from "./helpers/seed-client";

const PLAN_PROMPT = [
  "Thoth is off for this turn. Use native Plan mode for the current goal only.",
  "Before completing the Plan, call native request_user_input to ask which target to use: Local or CI.",
  "After the structured answer, produce a Plan for reporting the selected target.",
  "After I approve Implement, reply exactly REAL_NATIVE_PLAN_IMPLEMENTED.",
  "Do not modify files during the Plan turn.",
].join("\n");

function nativeSessionId(snapshot: {
  persistence?: { sessionId: string } | null;
  runtimeInfo?: { sessionId: string | null };
}): string | null {
  return snapshot.persistence?.sessionId ?? snapshot.runtimeInfo?.sessionId ?? null;
}

test.describe("Codex native Plan and Provider question", () => {
  test("answers the native question and implements the completed Plan on the same thread", async ({
    page,
  }) => {
    test.setTimeout(600_000);

    const workspace = await seedWorkspace({ repoPrefix: "codex-native-plan-question-" });
    try {
      const agent = await workspace.client.createAgent({
        provider: "codex",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: "Codex native Plan question e2e",
        modeId: "full-access",
        thinkingOptionId: "low",
      });
      const before = await workspace.client.fetchAgent({ agentId: agent.id });
      const threadId = before ? nativeSessionId(before.agent) : null;
      expect(threadId).toBeTruthy();

      await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: agent.id });
      await expectComposerVisible(page, { timeout: 60_000 });

      await page.getByTestId("agent-provider-config").filter({ visible: true }).first().click();
      await expect(page.getByTestId("agent-provider-config-sheet")).toBeVisible({
        timeout: 30_000,
      });
      const planFeature = page.getByTestId("provider-plan-feature");
      await expect(planFeature).toBeVisible({ timeout: 120_000 });
      await expect(page.getByTestId("provider-plan-feature-status")).toHaveText("Off", {
        timeout: 120_000,
      });
      await planFeature.click();
      await expect(page.getByTestId("provider-plan-feature-status")).toHaveText("On", {
        timeout: 30_000,
      });
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("agent-provider-config-sheet")).toHaveCount(0, {
        timeout: 30_000,
      });

      await submitMessage(page, PLAN_PROMPT);
      await waitForQuestionPrompt(page, 180_000);
      await expect(page.getByTestId("permission-plan-card")).toHaveCount(0);
      await chooseQuestionOption(page, "Local");
      await submitQuestionAnswers(page);

      const planCard = page.getByTestId("permission-plan-card").first();
      await expect(planCard).toBeVisible({ timeout: 180_000 });
      await expect(planCard).toContainText("Local");
      await expect(planCard).not.toContainText("Clarify card");
      await expect(page.getByTestId("question-form-card")).toHaveCount(0);
      await allowPermission(page);

      await expect(
        page.locator('[data-testid="assistant-message"]', {
          hasText: "REAL_NATIVE_PLAN_IMPLEMENTED",
        }),
      ).toBeVisible({ timeout: 180_000 });
      const finished = await workspace.client.waitForFinish(agent.id, 180_000);
      expect(finished.status).toBe("idle");
      expect(finished.final?.lastError ?? null).toBeNull();

      const after = await workspace.client.fetchAgent({ agentId: agent.id });
      expect(after).not.toBeNull();
      expect(after?.agent.pendingProviderQuestions ?? []).toEqual([]);
      expect(after ? nativeSessionId(after.agent) : null).toBe(threadId);
    } finally {
      await workspace.cleanup();
    }
  });
});
