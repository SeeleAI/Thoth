import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  Text,
  TextInput,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Check } from "lucide-react-native";
import type {
  ClarifyQuestionChoice,
  ClarifyQuestionSelectionMode,
} from "@thoth/protocol/thoth-runtime-contract";
import type {
  ThothClarifyCardAnswerPayload,
  ThothClarifyCardModel,
} from "@thoth/protocol/thoth/rpc-schemas";

type ClarifyAnswerSubmitter = (payload: ThothClarifyCardAnswerPayload) => void | Promise<void>;

interface ClarifyDecisionCardProps {
  card: ThothClarifyCardModel;
  onSubmit?: ClarifyAnswerSubmitter;
}

type Question = {
  id: string;
  question: string;
  selection_mode?: ClarifyQuestionSelectionMode;
  choices: ClarifyQuestionChoice[];
  note?: string;
};

const NOTE_PLACEHOLDER = "可补说明也可以只写备注。";

function getQuestions(card: ThothClarifyCardModel["card"]): Question[] {
  if ("questions" in card) {
    return card.questions;
  }
  return [
    {
      id: card.question_id,
      question: card.question,
      selection_mode: "single",
      choices: card.choices,
    },
  ];
}

function toggleMultipleChoice(selection: Set<string>, choiceId: string): Set<string> {
  const next = new Set(selection);
  if (next.has(choiceId)) {
    next.delete(choiceId);
  } else {
    next.add(choiceId);
  }
  return next;
}

function selectionMode(question: Question): ClarifyQuestionSelectionMode {
  return question.selection_mode ?? "single";
}

function compactNotes(notes: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(notes)
      .map(([key, value]) => [key, value?.trim() ?? ""] as const)
      .filter(([, value]) => value.length > 0),
  );
}

function summarizeRawAnswer(input: {
  questions: Question[];
  selections: Record<string, Set<string>>;
  choiceNotes: Record<string, Record<string, string | undefined>>;
  questionNotes: Record<string, string | undefined>;
}): string {
  const lines = input.questions.map((question) => {
    const selected = Array.from(input.selections[question.id] ?? []);
    const selectedLabels = selected
      .map((choiceId) => question.choices.find((choice) => choice.id === choiceId)?.label)
      .filter(Boolean)
      .join(", ");
    const questionNote = input.questionNotes[question.id]?.trim();
    const choiceNoteText = Object.entries(input.choiceNotes[question.id] ?? {})
      .map(([choiceId, note]) => {
        const trimmed = note?.trim();
        if (!trimmed) return null;
        const label = question.choices.find((choice) => choice.id === choiceId)?.label ?? choiceId;
        return `${label}: ${trimmed}`;
      })
      .filter(Boolean)
      .join("; ");
    return [question.question, selectedLabels, choiceNoteText, questionNote]
      .filter(Boolean)
      .join(" | ");
  });
  return lines.filter(Boolean).join("\n") || "note-only";
}

export function ClarifyDecisionCard({ card, onSubmit }: ClarifyDecisionCardProps) {
  const { theme } = useUnistyles();
  const questions = useMemo(() => getQuestions(card.card), [card.card]);
  const [selections, setSelections] = useState<Record<string, Set<string>>>({});
  const [choiceNotes, setChoiceNotes] = useState<
    Record<string, Record<string, string | undefined>>
  >({});
  const [questionNotes, setQuestionNotes] = useState<Record<string, string | undefined>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);

  const readonly = card.submitted || !onSubmit;
  const activeQuestion =
    questions[Math.min(activeQuestionIndex, Math.max(questions.length - 1, 0))];

  const isQuestionComplete = useCallback(
    (question: Question) => {
      const hasChoice = (selections[question.id]?.size ?? 0) > 0;
      const hasChoiceNote = Object.values(choiceNotes[question.id] ?? {}).some(
        (note) => (note ?? "").trim().length > 0,
      );
      const hasQuestionNote = (questionNotes[question.id] ?? "").trim().length > 0;
      return hasChoice || hasChoiceNote || hasQuestionNote;
    },
    [choiceNotes, questionNotes, selections],
  );

  const allQuestionsComplete = useMemo(
    () => questions.length > 0 && questions.every(isQuestionComplete),
    [isQuestionComplete, questions],
  );

  const moveToNextQuestion = useCallback(() => {
    setActiveQuestionIndex((current) => {
      if (current >= questions.length - 1) {
        return current;
      }
      return current + 1;
    });
  }, [questions.length]);

  const handleToggleChoice = useCallback(
    (question: Question, choiceId: string) => {
      if (readonly) return;
      if (selectionMode(question) === "single") {
        setSelections((current) => ({
          ...current,
          [question.id]: new Set([choiceId]),
        }));
        moveToNextQuestion();
        return;
      }
      setSelections((current) => ({
        ...current,
        [question.id]: toggleMultipleChoice(current[question.id] ?? new Set<string>(), choiceId),
      }));
    },
    [moveToNextQuestion, readonly],
  );

  const handleChoiceNoteChange = useCallback(
    (questionId: string, choiceId: string, note: string) => {
      setChoiceNotes((current) => ({
        ...current,
        [questionId]: {
          ...(current[questionId] ?? {}),
          [choiceId]: note,
        },
      }));
    },
    [],
  );

  const handleQuestionNoteChange = useCallback((questionId: string, note: string) => {
    setQuestionNotes((current) => ({
      ...current,
      [questionId]: note,
    }));
  }, []);

  const submit = useCallback(
    async (intent: ThothClarifyCardAnswerPayload["intent"]) => {
      if (!onSubmit || card.submitted || isSubmitting) return;
      const rawAnswer =
        intent === "recommend"
          ? "你推荐"
          : intent === "decide"
            ? "你决定"
            : intent === "stop"
              ? "暂停继续询问"
              : summarizeRawAnswer({ questions, selections, choiceNotes, questionNotes });
      const answers = questions.map((question) => ({
        question_id: question.id,
        choice_ids: Array.from(selections[question.id] ?? []),
        choice_notes: compactNotes(choiceNotes[question.id] ?? {}),
        ...(questionNotes[question.id]?.trim() ? { note: questionNotes[question.id]?.trim() } : {}),
      }));
      setIsSubmitting(true);
      try {
        await onSubmit({
          intent,
          question_card_id: card.id,
          title: card.title,
          answers,
          raw_answer: rawAnswer,
        });
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      card.id,
      card.submitted,
      card.title,
      choiceNotes,
      isSubmitting,
      onSubmit,
      questionNotes,
      questions,
      selections,
    ],
  );

  const handleSubmitChoices = useCallback(() => {
    const intent = Object.values(selections).some((set) => set.size > 0)
      ? "submit_choices"
      : "note_only";
    void submit(intent);
  }, [selections, submit]);
  const handleRecommend = useCallback(() => {
    void submit("recommend");
  }, [submit]);
  const handleStop = useCallback(() => {
    void submit("stop");
  }, [submit]);

  const submitDisabled = readonly || isSubmitting || !allQuestionsComplete;
  const intentDisabled = readonly || isSubmitting;

  if (card.submitted) {
    return (
      <View style={styles.card} testID="clarify-decision-card">
        <View style={styles.submittedHeader}>
          <View style={styles.header}>
            <Text style={styles.roundLabel}>{card.roundLabel}</Text>
            <Text style={styles.title} testID="clarify-card-title">
              {card.title}
            </Text>
          </View>
          <View style={styles.readonlyBanner} testID="clarify-card-readonly">
            <Text style={styles.readonlyText}>{card.submittedSummary ?? "已提交"}</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card} testID="clarify-decision-card">
      <View style={styles.header}>
        <Text style={styles.roundLabel}>{card.roundLabel}</Text>
        <Text style={styles.title} testID="clarify-card-title">
          {card.title}
        </Text>
        {card.whyNow ? (
          <Text style={styles.whyNow} testID="clarify-card-why-now">
            {card.whyNow}
          </Text>
        ) : null}
      </View>

      <View style={styles.questionNav} testID="clarify-card-question-nav">
        {questions.map((question, index) => {
          const selected = selections[question.id]?.size ?? 0;
          const hasNote =
            (questionNotes[question.id] ?? "").trim().length > 0 ||
            Object.values(choiceNotes[question.id] ?? {}).some(
              (note) => (note ?? "").trim().length > 0,
            );
          const isActive = index === activeQuestionIndex;
          const navStyle = ({
            pressed,
            hovered,
          }: PressableStateCallbackType & { hovered?: boolean }) => [
            styles.questionNavButton,
            (isActive || hovered) && {
              backgroundColor: theme.colors.surface2,
              borderColor: theme.colors.borderAccent,
            },
            pressed && styles.pressed,
          ];
          return (
            <Pressable
              key={question.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              onPress={() => setActiveQuestionIndex(index)}
              style={navStyle}
              testID={`clarify-card-question-tab-${index + 1}`}
            >
              <Text style={styles.questionNavText}>{index + 1}</Text>
              {selected > 0 || hasNote ? <View style={styles.questionAnsweredDot} /> : null}
            </Pressable>
          );
        })}
      </View>

      {activeQuestion ? (
        <View style={styles.questionBlock} testID={`clarify-card-question-${activeQuestion.id}`}>
          <Text style={styles.questionKicker}>
            问题 {Math.min(activeQuestionIndex + 1, questions.length)} / {questions.length}
          </Text>
          <View
            style={[
              styles.questionModeShell,
              selectionMode(activeQuestion) === "multiple"
                ? styles.questionModeShellMultiple
                : styles.questionModeShellSingle,
            ]}
            testID={`clarify-card-question-mode-${activeQuestion.id}-${selectionMode(activeQuestion)}`}
          >
            <Text
              style={[
                styles.questionModeText,
                selectionMode(activeQuestion) === "multiple"
                  ? styles.questionModeTextMultiple
                  : styles.questionModeTextSingle,
              ]}
            >
              {selectionMode(activeQuestion) === "multiple" ? "多选" : "单选"}
            </Text>
          </View>
          <Text style={styles.questionText}>{activeQuestion.question}</Text>
          {activeQuestion.note ? (
            <Text style={styles.questionNote}>{activeQuestion.note}</Text>
          ) : null}
          <View style={styles.choices}>
            {activeQuestion.choices.map((choice) => {
              const selected = selections[activeQuestion.id] ?? new Set<string>();
              const isSelected = selected.has(choice.id);
              const isMultiple = selectionMode(activeQuestion) === "multiple";
              const choicePressableStyle = ({
                pressed,
                hovered,
              }: PressableStateCallbackType & { hovered?: boolean }) => [
                styles.choice,
                isMultiple ? styles.choiceMultiple : styles.choiceSingle,
                Boolean(hovered) && {
                  backgroundColor: theme.colors.surface2,
                },
                isSelected &&
                  (isMultiple ? styles.choiceSelectedMultiple : styles.choiceSelectedSingle),
                pressed && styles.pressed,
              ];
              return (
                <View key={choice.id} style={styles.choiceWrap}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={choice.label}
                    accessibilityState={{ selected: isSelected, checked: isSelected }}
                    onPress={() => handleToggleChoice(activeQuestion, choice.id)}
                    style={choicePressableStyle}
                    testID={`clarify-card-choice-${activeQuestion.id}-${choice.id}`}
                  >
                    <View style={styles.choiceText}>
                      <Text style={styles.choiceLabel}>{choice.label}</Text>
                      <Text style={styles.choiceDescription}>{choice.description}</Text>
                    </View>
                    {isSelected ? <Check size={16} color={theme.colors.foregroundMuted} /> : null}
                  </Pressable>
                  {isSelected ? (
                    <TextInput
                      placeholder={NOTE_PLACEHOLDER}
                      placeholderTextColor={theme.colors.foregroundMuted}
                      value={choiceNotes[activeQuestion.id]?.[choice.id] ?? ""}
                      onChangeText={(value) =>
                        handleChoiceNoteChange(activeQuestion.id, choice.id, value)
                      }
                      style={styles.noteInput}
                      testID={`clarify-card-choice-note-${activeQuestion.id}-${choice.id}`}
                    />
                  ) : null}
                </View>
              );
            })}
          </View>
          <TextInput
            placeholder={NOTE_PLACEHOLDER}
            placeholderTextColor={theme.colors.foregroundMuted}
            value={questionNotes[activeQuestion.id] ?? ""}
            onChangeText={(value) => handleQuestionNoteChange(activeQuestion.id, value)}
            style={styles.noteInput}
            testID={`clarify-card-question-note-${activeQuestion.id}`}
          />
        </View>
      ) : null}

      <View style={styles.actions}>
        <View style={styles.actionsLeft}>
          <RecommendButton
            disabled={intentDisabled}
            onPress={handleRecommend}
            testID="clarify-card-recommend"
          />
        </View>
        <View style={styles.actionsRight}>
          <ActionButton
            label="提交"
            disabled={submitDisabled}
            primary
            onPress={handleSubmitChoices}
            testID="clarify-card-submit"
          />
          <ActionButton
            label="取消"
            disabled={intentDisabled}
            onPress={handleStop}
            testID="clarify-card-cancel"
          />
        </View>
      </View>
    </View>
  );
}

function RecommendButton({
  disabled,
  onPress,
  testID,
}: {
  disabled: boolean;
  onPress: () => void;
  testID: string;
}) {
  const { theme } = useUnistyles();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (disabled) {
      return undefined;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [disabled, pulse]);

  const glowOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.25, 0.65],
  });

  const pressableStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.action,
      styles.recommendAction,
      !disabled && styles.recommendActionEnabled,
      !disabled && Boolean(hovered) && { backgroundColor: "rgba(14, 165, 233, 0.2)" },
      pressed && styles.pressed,
      disabled && styles.disabled,
    ],
    [disabled],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={pressableStyle}
      testID={testID}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.recommendGlow, { opacity: glowOpacity }]}
      />
      <Text
        style={[styles.actionText, styles.recommendActionText, { color: theme.colors.foreground }]}
      >
        你推荐
      </Text>
    </Pressable>
  );
}

function ActionButton({
  label,
  disabled,
  primary,
  onPress,
  testID,
}: {
  label: string;
  disabled: boolean;
  primary?: boolean;
  onPress: () => void;
  testID: string;
}) {
  const { theme } = useUnistyles();
  const pressableStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.action,
      primary && {
        backgroundColor: theme.colors.accent,
        borderColor: theme.colors.accent,
      },
      primary &&
        disabled && {
          backgroundColor: "rgba(32, 116, 74, 0.22)",
          borderColor: "rgba(124, 203, 160, 0.42)",
        },
      !primary && Boolean(hovered) && { backgroundColor: theme.colors.surface2 },
      pressed && styles.pressed,
      disabled && styles.disabled,
    ],
    [disabled, primary, theme.colors.accent, theme.colors.surface2],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={pressableStyle}
      testID={testID}
    >
      <Text style={[styles.actionText, primary && styles.primaryActionText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    padding: theme.spacing[4],
    gap: theme.spacing[4],
  },
  header: {
    gap: theme.spacing[1],
  },
  submittedHeader: {
    gap: theme.spacing[3],
  },
  roundLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  whyNow: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
  },
  questionNav: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  questionNavButton: {
    width: 34,
    height: 30,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface0,
    alignItems: "center",
    justifyContent: "center",
  },
  questionNavText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  questionAnsweredDot: {
    position: "absolute",
    right: 5,
    top: 5,
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: theme.colors.accent,
  },
  questions: {
    gap: theme.spacing[4],
  },
  questionBlock: {
    gap: theme.spacing[2],
  },
  questionKicker: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  questionText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  questionModeShell: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 3,
  },
  questionModeShellSingle: {
    backgroundColor: "rgba(37, 99, 235, 0.12)",
    borderColor: "rgba(96, 165, 250, 0.55)",
  },
  questionModeShellMultiple: {
    backgroundColor: "rgba(147, 51, 234, 0.12)",
    borderColor: "rgba(192, 132, 252, 0.55)",
  },
  questionModeText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  questionModeTextSingle: {
    color: "#93c5fd",
  },
  questionModeTextMultiple: {
    color: "#d8b4fe",
  },
  questionNote: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
  },
  choices: {
    gap: theme.spacing[2],
  },
  choiceWrap: {
    gap: theme.spacing[1],
  },
  choice: {
    borderWidth: 1,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface0,
    padding: theme.spacing[3],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  choiceSingle: {
    borderColor: "rgba(96, 165, 250, 0.28)",
  },
  choiceMultiple: {
    borderColor: "rgba(192, 132, 252, 0.28)",
  },
  choiceSelectedSingle: {
    backgroundColor: "rgba(37, 99, 235, 0.16)",
    borderColor: "rgba(96, 165, 250, 0.78)",
  },
  choiceSelectedMultiple: {
    backgroundColor: "rgba(147, 51, 234, 0.16)",
    borderColor: "rgba(192, 132, 252, 0.78)",
  },
  choiceText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  choiceLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  choiceDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
  },
  noteInput: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface0,
    padding: theme.spacing[3],
    fontSize: theme.fontSize.sm,
  },
  readonlyChoice: {
    opacity: theme.opacity[50],
  },
  readonlyBanner: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[3],
    backgroundColor: theme.colors.surface2,
  },
  readonlyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  actionsLeft: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  actionsRight: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  action: {
    minHeight: 36,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[3],
    alignItems: "center",
    justifyContent: "center",
  },
  recommendAction: {
    overflow: "hidden",
    borderColor: "rgba(14, 165, 233, 0.7)",
    backgroundColor: "rgba(14, 165, 233, 0.12)",
  },
  recommendActionEnabled: {
    borderColor: "rgba(168, 85, 247, 0.65)",
  },
  recommendGlow: {
    position: "absolute",
    left: -16,
    right: -16,
    top: -18,
    bottom: -18,
    backgroundColor: "rgba(14, 165, 233, 0.32)",
    transform: [{ rotate: "-8deg" }],
  },
  actionText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  recommendActionText: {
    zIndex: 1,
  },
  primaryActionText: {
    color: theme.colors.accentForeground,
  },
  disabled: {
    opacity: theme.opacity[50],
  },
  pressed: {
    opacity: 0.85,
  },
}));
