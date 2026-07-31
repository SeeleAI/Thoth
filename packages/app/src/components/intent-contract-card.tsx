import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import type {
  ThothIntentContractAnswerPayload,
  ThothIntentContractCardModel,
} from "@thoth/protocol/thoth/rpc-schemas";

type IntentContractSubmitter = (payload: ThothIntentContractAnswerPayload) => void | Promise<void>;

interface IntentContractCardProps {
  card: ThothIntentContractCardModel;
  onSubmit?: IntentContractSubmitter;
}

function buttonStyle({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.actionButton, (hovered || pressed) && styles.actionButtonHovered];
}

export function IntentContractCard({ card, onSubmit }: IntentContractCardProps) {
  const { theme } = useUnistyles();
  const readonly = card.submitted || !onSubmit;
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const noteTrimmed = note.trim();
  const actionsDisabled = readonly || isSubmitting;
  const executionAction =
    card.turnControls.mode === "quick"
      ? {
          intent: "accept_quick" as const,
          label: "确认并前台执行",
          testId: "thoth-intent-contract-accept-quick",
        }
      : {
          intent: "accept_loop" as const,
          label: "确认并注册 Loop",
          testId: "thoth-intent-contract-accept-loop",
        };

  const submit = useCallback(
    async (intent: ThothIntentContractAnswerPayload["intent"]) => {
      if (!onSubmit || readonly || isSubmitting) return;
      setIsSubmitting(true);
      try {
        await onSubmit({
          intent,
          cardId: card.id,
          ...(noteTrimmed ? { note: noteTrimmed } : {}),
          rawAnswer:
            intent === "annotate"
              ? noteTrimmed || "请按批注修订意图合同"
              : intent === "accept_loop"
                ? "确认意图合同并注册 Loop"
                : intent === "accept_quick"
                  ? "确认意图合同并前台执行"
                  : "取消本轮意图合同",
        });
      } finally {
        setIsSubmitting(false);
      }
    },
    [card.id, isSubmitting, noteTrimmed, onSubmit, readonly],
  );

  const sections = useMemo(
    () => [
      { label: "目标", values: [card.contract.objective] },
      { label: "不做", values: card.contract.nonGoals },
      { label: "不变量", values: card.contract.invariants },
      {
        label: "验收声明",
        values: card.contract.acceptanceClaims.map((claim) => claim.statement),
      },
      { label: "风险边界", values: card.contract.riskBoundary },
    ],
    [card.contract],
  );

  return (
    <View style={styles.card} testID="thoth-intent-contract-card">
      <Text style={styles.roundLabel}>Intent Contract</Text>
      <Text style={styles.cardTitle}>确认目标、边界与验收</Text>
      <Text style={styles.title}>{card.contract.title}</Text>
      <Text style={styles.provenance}>{card.provenanceSummary}</Text>

      <View style={styles.sections}>
        {sections.map((section) =>
          section.values.length > 0 ? (
            <View key={section.label} style={styles.section}>
              <Text style={styles.sectionLabel}>{section.label}</Text>
              {section.values.map((value, index) => (
                <Text key={`${section.label}-${index}`} style={styles.sectionValue}>
                  {value}
                </Text>
              ))}
            </View>
          ) : null,
        )}
      </View>

      <View style={styles.finalAuthority}>
        <Text style={styles.sectionLabel}>完成确认</Text>
        <Text style={styles.sectionValue}>
          {card.contract.escalationPolicy.finalConfirmation === "required"
            ? "最终完成需要你确认"
            : "证据满足全部验收后自动完成"}
        </Text>
      </View>

      {readonly ? (
        <View style={styles.readonly} testID="thoth-intent-contract-readonly">
          <Text style={styles.readonlyText}>{card.submittedSummary ?? "已提交"}</Text>
        </View>
      ) : (
        <>
          <TextInput
            multiline
            editable={!actionsDisabled}
            placeholder="写下需要修订的目标、边界或验收"
            placeholderTextColor={theme.colors.foregroundMuted}
            style={styles.noteInput}
            testID="thoth-intent-contract-note"
            value={note}
            onChangeText={setNote}
          />
          <View style={styles.actions}>
            <Pressable
              disabled={actionsDisabled}
              onPress={() => void submit(executionAction.intent)}
              style={buttonStyle}
              testID={executionAction.testId}
            >
              <Text style={styles.actionText}>{executionAction.label}</Text>
            </Pressable>
            <Pressable
              disabled={actionsDisabled || noteTrimmed.length === 0}
              onPress={() => void submit("annotate")}
              style={buttonStyle}
              testID="thoth-intent-contract-annotate"
            >
              <Text style={styles.actionText}>修订</Text>
            </Pressable>
            <Pressable
              disabled={actionsDisabled}
              onPress={() => void submit("cancel")}
              style={buttonStyle}
              testID="thoth-intent-contract-cancel"
            >
              <Text style={styles.actionText}>取消</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  roundLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  cardTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  provenance: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  sections: {
    gap: theme.spacing[3],
  },
  section: {
    gap: theme.spacing[1],
  },
  sectionLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  sectionValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  finalAuthority: {
    gap: theme.spacing[1],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  noteInput: {
    minHeight: 84,
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    padding: theme.spacing[3],
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface0,
    textAlignVertical: "top",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  actionButton: {
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surface0,
  },
  actionButtonHovered: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.borderAccent,
  },
  actionText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  readonly: {
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    padding: theme.spacing[3],
    backgroundColor: theme.colors.surface0,
  },
  readonlyText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
