import type { TFunction } from "i18next";

export function resolveSubmitAccessibilityLabel(input: {
  submitButtonAccessibilityLabel: string | undefined;
  canPressLoadingButton: boolean;
  defaultActionQueues: boolean;
  isAgentRunning: boolean;
  t: TFunction;
}): string {
  if (input.submitButtonAccessibilityLabel) return input.submitButtonAccessibilityLabel;
  if (input.canPressLoadingButton) return input.t("composer.input.interruptAgent");
  if (input.defaultActionQueues) return input.t("composer.input.queueMessage");
  if (input.isAgentRunning) return input.t("composer.input.sendAndInterrupt");
  return input.t("composer.input.sendMessage");
}

export function resolveSendTooltipLabel(input: {
  submitButtonAccessibilityLabel: string | undefined;
  defaultActionQueues: boolean;
  t: TFunction;
}): string {
  if (input.submitButtonAccessibilityLabel) return input.submitButtonAccessibilityLabel;
  return input.defaultActionQueues
    ? input.t("composer.input.queue")
    : input.t("composer.input.send");
}
