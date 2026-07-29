import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Check, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type {
  ProviderQuestionItem,
  ProviderQuestionOption,
  ProviderQuestionProjection,
  ProviderQuestionResolution,
} from "@thoth/protocol/agent-types";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  areQuestionsAnswered,
  buildProviderQuestionResolution,
  isQuestionAnswered,
  questionShowsTextInput,
} from "./question-form-card-core";

interface QuestionFormCardProps {
  question: ProviderQuestionProjection;
  onRespond: (resolution: ProviderQuestionResolution) => Promise<void>;
  isResponding: boolean;
  error: string | null;
}

function QuestionOptionRow({
  questionId,
  option,
  selected,
  disabled,
  onToggle,
}: {
  questionId: string;
  option: ProviderQuestionOption;
  selected: boolean;
  disabled: boolean;
  onToggle: (questionId: string, value: string) => void;
}) {
  const { theme } = useUnistyles();
  const handlePress = useCallback(
    () => onToggle(questionId, option.value),
    [onToggle, option.value, questionId],
  );
  const style = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.optionItem,
      (selected || Boolean(hovered)) && { backgroundColor: theme.colors.surface2 },
      pressed && styles.pressed,
    ],
    [selected, theme.colors.surface2],
  );
  return (
    <Pressable
      style={style}
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={option.label}
      accessibilityState={{ selected }}
      aria-selected={selected}
      testID={`question-form-option-${questionId}-${option.value}`}
    >
      <View style={styles.optionContent}>
        <View style={styles.optionTextBlock}>
          <Text style={[styles.optionLabel, { color: theme.colors.foreground }]}>
            {option.label}
          </Text>
          {option.description ? (
            <Text style={[styles.optionDescription, { color: theme.colors.foregroundMuted }]}>
              {option.description}
            </Text>
          ) : null}
        </View>
        {selected ? <Check size={16} color={theme.colors.foregroundMuted} /> : null}
      </View>
    </Pressable>
  );
}

function QuestionNavButton({
  index,
  total,
  active,
  disabled,
  onSelect,
}: {
  index: number;
  total: number;
  active: boolean;
  disabled: boolean;
  onSelect: (index: number) => void;
}) {
  const { theme } = useUnistyles();
  const handlePress = useCallback(() => onSelect(index), [index, onSelect]);
  const style = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.navButton,
      {
        backgroundColor: active || Boolean(hovered) ? theme.colors.surface2 : theme.colors.surface1,
        borderColor: active ? theme.colors.foregroundMuted : theme.colors.border,
      },
      pressed && styles.pressed,
    ],
    [
      active,
      theme.colors.border,
      theme.colors.foregroundMuted,
      theme.colors.surface1,
      theme.colors.surface2,
    ],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Question ${index + 1} of ${total}`}
      accessibilityState={{ selected: active }}
      aria-selected={active}
      testID={`question-form-question-nav-${index + 1}`}
      style={style}
      onPress={handlePress}
      disabled={disabled}
    >
      <Text
        style={[
          styles.navText,
          { color: active ? theme.colors.foreground : theme.colors.foregroundMuted },
        ]}
      >
        {index + 1}
      </Text>
    </Pressable>
  );
}

function OtherInput({
  question,
  value,
  disabled,
  onChange,
  onSubmit,
}: {
  question: ProviderQuestionItem;
  value: string;
  disabled: boolean;
  onChange: (questionId: string, text: string) => void;
  onSubmit: () => void;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const handleChange = useCallback(
    (text: string) => onChange(question.id, text),
    [onChange, question.id],
  );
  return (
    <TextInput
      style={[
        styles.otherInput,
        {
          borderColor: value.length > 0 ? theme.colors.borderAccent : theme.colors.border,
          color: theme.colors.foreground,
          backgroundColor: theme.colors.surface2,
        },
      ]}
      accessibilityLabel={question.prompt}
      placeholder={
        question.options.length === 0
          ? t("message.question.answerPlaceholder")
          : t("message.question.otherPlaceholder")
      }
      placeholderTextColor={theme.colors.foregroundMuted}
      value={value}
      onChangeText={handleChange}
      onSubmitEditing={onSubmit}
      editable={!disabled}
      blurOnSubmit={false}
      secureTextEntry={question.secret}
      testID={`question-form-other-${question.id}`}
    />
  );
}

export function QuestionFormCard({
  question: projection,
  onRespond,
  isResponding,
  error,
}: QuestionFormCardProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const isMobile = useIsCompactFormFactor();
  const questions = projection.questions;
  const [selections, setSelections] = useState<Record<string, Set<string>>>({});
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({});
  const [activeIndex, setActiveIndex] = useState(0);
  const [respondingAction, setRespondingAction] = useState<"submit" | "dismiss" | null>(null);

  const activeQuestion = questions[Math.min(activeIndex, questions.length - 1)]!;
  const activeAnswered = isQuestionAnswered(activeQuestion, selections, otherTexts);
  const allAnswered = areQuestionsAnswered(questions, selections, otherTexts);
  const isLastQuestion = activeIndex >= questions.length - 1;

  const toggleOption = useCallback(
    (questionId: string, value: string) => {
      const item = questions.find((candidate) => candidate.id === questionId);
      if (!item) return;
      setSelections((current) => {
        const nextValues = new Set(current[questionId] ?? []);
        if (item.selectionMode === "multiple") {
          if (nextValues.has(value)) nextValues.delete(value);
          else nextValues.add(value);
        } else {
          const alreadySelected = nextValues.has(value);
          nextValues.clear();
          if (!alreadySelected) nextValues.add(value);
        }
        return { ...current, [questionId]: nextValues };
      });
      setOtherTexts((current) => {
        if (!current[questionId]) return current;
        const next = { ...current };
        delete next[questionId];
        return next;
      });
      if (item.selectionMode === "single" && activeQuestion.id === questionId) {
        setActiveIndex((index) => Math.min(index + 1, questions.length - 1));
      }
    },
    [activeQuestion.id, questions],
  );

  const setOtherText = useCallback((questionId: string, text: string) => {
    setOtherTexts((current) => ({ ...current, [questionId]: text }));
    if (text.length > 0) {
      setSelections((current) => ({ ...current, [questionId]: new Set<string>() }));
    }
  }, []);

  const submit = useCallback(async () => {
    if (!allAnswered || isResponding) return;
    setRespondingAction("submit");
    try {
      await onRespond(buildProviderQuestionResolution(questions, selections, otherTexts));
    } catch {
      setRespondingAction(null);
    }
  }, [allAnswered, isResponding, onRespond, otherTexts, questions, selections]);

  const dismiss = useCallback(async () => {
    if (isResponding) return;
    setRespondingAction("dismiss");
    try {
      await onRespond({ type: "dismiss" });
    } catch {
      setRespondingAction(null);
    }
  }, [isResponding, onRespond]);

  const primaryAction = useCallback(() => {
    if (!isLastQuestion) {
      if (!activeAnswered || isResponding) return;
      setActiveIndex((index) => Math.min(index + 1, questions.length - 1));
      return;
    }
    void submit();
  }, [activeAnswered, isLastQuestion, isResponding, questions.length, submit]);

  const primaryDisabled = isResponding || (isLastQuestion ? !allAnswered : !activeAnswered);
  const selected = selections[activeQuestion.id] ?? new Set<string>();
  const otherText = otherTexts[activeQuestion.id] ?? "";

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.colors.surface1, borderColor: theme.colors.border },
      ]}
      testID="question-form-card"
    >
      <View style={styles.topRow}>
        <View style={styles.header}>
          {activeQuestion.header ? (
            <Text style={[styles.eyebrow, { color: theme.colors.foregroundMuted }]}>
              {activeQuestion.header}
            </Text>
          ) : null}
          <Text
            testID="question-form-current-question"
            style={[styles.questionText, { color: theme.colors.foreground }]}
          >
            {activeQuestion.prompt}
          </Text>
        </View>
        <View
          style={[styles.nav, isMobile && styles.navMobile]}
          testID="question-form-question-nav"
        >
          {questions.map((item, index) => (
            <QuestionNavButton
              key={item.id}
              index={index}
              total={questions.length}
              active={index === activeIndex}
              disabled={isResponding}
              onSelect={setActiveIndex}
            />
          ))}
        </View>
      </View>

      <View key={activeQuestion.id} style={styles.questionBlock}>
        {activeQuestion.options.length > 0 ? (
          <View style={styles.optionsWrap}>
            {activeQuestion.options.map((option, index) => (
              <QuestionOptionRow
                key={`${option.value}:${index}`}
                questionId={activeQuestion.id}
                option={option}
                selected={selected.has(option.value)}
                disabled={isResponding}
                onToggle={toggleOption}
              />
            ))}
          </View>
        ) : null}
        {questionShowsTextInput(activeQuestion) ? (
          <OtherInput
            question={activeQuestion}
            value={otherText}
            disabled={isResponding}
            onChange={setOtherText}
            onSubmit={primaryAction}
          />
        ) : null}
      </View>

      {error ? (
        <Text
          testID="question-form-error"
          style={[styles.error, { color: theme.colors.destructive }]}
        >
          {error}
        </Text>
      ) : null}

      <View style={[styles.actions, !isMobile && styles.actionsDesktop]}>
        <Pressable
          style={({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
            styles.actionButton,
            {
              backgroundColor: hovered ? theme.colors.surface2 : theme.colors.surface1,
              borderColor: theme.colors.borderAccent,
            },
            pressed && styles.pressed,
          ]}
          onPress={() => void dismiss()}
          disabled={isResponding}
          accessibilityRole="button"
          accessibilityLabel={t("common.actions.dismiss")}
          testID="question-form-dismiss"
        >
          {respondingAction === "dismiss" ? (
            <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
          ) : (
            <View style={styles.actionContent}>
              <X size={14} color={theme.colors.foregroundMuted} />
              <Text style={[styles.actionText, { color: theme.colors.foregroundMuted }]}>
                {t("common.actions.dismiss")}
              </Text>
            </View>
          )}
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            {
              backgroundColor: theme.colors.accent,
              borderColor: theme.colors.accent,
              opacity: primaryDisabled ? 0.5 : 1,
            },
            pressed && !primaryDisabled ? styles.pressed : null,
          ]}
          onPress={primaryAction}
          disabled={primaryDisabled}
          accessibilityRole="button"
          accessibilityLabel={
            isLastQuestion ? t("message.question.submit") : t("message.question.next")
          }
          testID="question-form-primary-action"
        >
          {respondingAction === "submit" ? (
            <ActivityIndicator size="small" color={theme.colors.accentForeground} />
          ) : (
            <View style={styles.actionContent}>
              <Check size={14} color={theme.colors.accentForeground} />
              <Text style={[styles.actionText, { color: theme.colors.accentForeground }]}>
                {isLastQuestion ? t("message.question.submit") : t("message.question.next")}
              </Text>
            </View>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    padding: theme.spacing[3],
    borderRadius: theme.spacing[2],
    borderWidth: 1,
    gap: theme.spacing[3],
  },
  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  header: { flex: 1, gap: theme.spacing[1], paddingHorizontal: theme.spacing[3] },
  eyebrow: { fontSize: theme.fontSize.xs, fontWeight: theme.fontWeight.medium },
  questionText: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 22,
  },
  questionBlock: { gap: theme.spacing[2] },
  optionsWrap: { gap: theme.spacing[1] },
  optionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  optionContent: { flex: 1, flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  optionTextBlock: { flex: 1, gap: 2 },
  optionLabel: { fontSize: theme.fontSize.sm },
  optionDescription: { fontSize: theme.fontSize.xs, lineHeight: 16 },
  nav: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  navMobile: { paddingRight: theme.spacing[1] },
  navButton: {
    minWidth: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: theme.borderWidth[1],
  },
  navText: { fontSize: theme.fontSize.xs, fontWeight: "700" },
  otherInput: {
    borderWidth: 1,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    fontSize: theme.fontSize.sm,
  },
  error: { fontSize: theme.fontSize.sm, paddingHorizontal: theme.spacing[3] },
  actions: { gap: theme.spacing[2] },
  actionsDesktop: { flexDirection: "row", alignItems: "center" },
  actionButton: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    borderWidth: theme.borderWidth[1],
  },
  actionContent: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  actionText: { fontSize: theme.fontSize.sm },
  pressed: { opacity: 0.9 },
}));
