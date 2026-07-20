import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
} from "@earendil-works/pi-tui";
import type {
  Question,
  QuestionAnswer,
  QuestionnaireResult,
  RenderOption,
} from "./types.ts";
import { formatRenderedAnswer } from "./format.ts";

export function createQuestionnaireController(
  questions: Question[],
  theme: any,
  tui: any,
  done: (result: QuestionnaireResult) => void,
) {
  const isMulti = questions.length > 1;
  const totalTabs = questions.length + 1;
  let currentTab = 0,
    optionIndex = 0,
    inputMode = false;
  let inputQuestionId: string | null = null;
  let cachedLines: string[] | undefined;
  const answers = new Map<string, QuestionAnswer>();
  const editor = new Editor(tui, {
    borderColor: (segment) => theme.fg("accent", segment),
    selectList: {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    },
  } as EditorTheme);

  const currentQuestion = () => questions[currentTab];
  const refresh = () => {
    cachedLines = undefined;
    tui.requestRender();
  };
  const submit = (cancelled: boolean) =>
    done({ questions, answers: [...answers.values()], cancelled });
  const hasAnswer = (id: string) => {
    const a = answers.get(id);
    return !!a && (a.values.length > 0 || !!a.custom);
  };
  const allAnswered = () => questions.every((q) => hasAnswer(q.id));
  const currentAnswer = (id: string): QuestionAnswer =>
    answers.get(id) || { id, values: [], labels: [] };
  const saveAnswer = (id: string, answer: QuestionAnswer) =>
    answers.set(id, answer);
  const currentOptions = (): RenderOption[] => {
    const q = currentQuestion();
    if (!q) return [];
    const options: RenderOption[] = [...q.options];
    if (q.multiple)
      options.push({ value: "__done__", label: "Done / continue" });
    if (q.allowOther)
      options.push({
        value: "__other__",
        label: "Type something.",
        isOther: true,
      });
    return options;
  };
  const advanceAfterAnswer = () => {
    if (!isMulti) return submit(false);
    currentTab =
      currentTab < questions.length - 1 ? currentTab + 1 : questions.length;
    optionIndex = 0;
    refresh();
  };
  const toggleOption = (
    question: Question,
    option: RenderOption,
    index: number,
  ) => {
    const answer = currentAnswer(question.id);
    const next: QuestionAnswer = {
      ...answer,
      id: question.id,
      values: [...answer.values],
      labels: [...answer.labels],
      selectedIndices: answer.selectedIndices
        ? [...answer.selectedIndices]
        : [],
    };
    const existingIndex = next.values.indexOf(option.value);
    if (existingIndex >= 0) {
      next.values.splice(existingIndex, 1);
      next.labels.splice(existingIndex, 1);
      next.selectedIndices = next.selectedIndices?.filter(
        (i) => i !== index + 1,
      );
    } else {
      next.values.push(option.value);
      next.labels.push(option.label);
      next.selectedIndices?.push(index + 1);
    }
    saveAnswer(question.id, next);
  };
  const finalizeMulti = (question: Question) => {
    const answer = answers.get(question.id);
    if (!answer || (answer.values.length === 0 && !answer.custom)) return;
    advanceAfterAnswer();
  };

  editor.onSubmit = (value) => {
    if (!inputQuestionId) return;
    const questionId = inputQuestionId;
    const trimmed = value.trim() || "(no response)";
    saveAnswer(questionId, {
      ...currentAnswer(questionId),
      id: questionId,
      custom: trimmed,
    });
    inputMode = false;
    const question = questions.find((q) => q.id === questionId);
    inputQuestionId = null;
    editor.setText("");
    if (question?.multiple) refresh();
    else advanceAfterAnswer();
  };

  const handleInput = (data: string) => {
    if (inputMode) {
      if (matchesKey(data, Key.escape)) {
        inputMode = false;
        inputQuestionId = null;
        editor.setText("");
        refresh();
        return;
      }
      editor.handleInput(data);
      refresh();
      return;
    }
    const question = currentQuestion();
    const options = currentOptions();
    if (isMulti) {
      if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
        currentTab = (currentTab + 1) % totalTabs;
        optionIndex = 0;
        refresh();
        return;
      }
      if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
        currentTab = (currentTab - 1 + totalTabs) % totalTabs;
        optionIndex = 0;
        refresh();
        return;
      }
    }
    if (currentTab === questions.length) {
      if (matchesKey(data, Key.enter) && allAnswered()) submit(false);
      else if (matchesKey(data, Key.escape)) submit(true);
      return;
    }
    if (matchesKey(data, Key.up)) {
      optionIndex = Math.max(0, optionIndex - 1);
      refresh();
      return;
    }
    if (matchesKey(data, Key.down)) {
      optionIndex = Math.min(options.length - 1, optionIndex + 1);
      refresh();
      return;
    }
    if (matchesKey(data, Key.enter) && question) {
      const option = options[optionIndex];
      if (option.isOther) {
        inputMode = true;
        inputQuestionId = question.id;
        editor.setText("");
        refresh();
        return;
      }
      if (option.value === "__done__" && question.multiple)
        return finalizeMulti(question);
      if (question.multiple) {
        toggleOption(question, option, optionIndex);
        refresh();
        return;
      }
      saveAnswer(question.id, {
        id: question.id,
        values: [option.value],
        labels: [option.label],
        selectedIndices: [optionIndex + 1],
      });
      advanceAfterAnswer();
      return;
    }
    if (matchesKey(data, Key.escape)) submit(true);
  };

  const render = (width: number): string[] => {
    if (cachedLines) return cachedLines;
    const lines: string[] = [];
    const question = currentQuestion();
    const options = currentOptions();
    const add = (text: string) => lines.push(text);
    add(theme.fg("accent", "─".repeat(width)));
    if (isMulti) {
      const tabs: string[] = ["← "];
      for (let index = 0; index < questions.length; index++) {
        const isActive = index === currentTab;
        const isAnswered = hasAnswer(questions[index].id);
        const label = questions[index].label;
        const box = isAnswered ? "■" : "□";
        const color = isAnswered ? "success" : "muted";
        const tabText = ` ${box} ${label} `;
        const styled = isActive
          ? theme.bg("selectedBg", theme.fg("text", tabText))
          : theme.fg(color, tabText);
        tabs.push(`${styled} `);
      }
      const submitText = " ✓ Submit ";
      const submitStyled =
        currentTab === questions.length
          ? theme.bg("selectedBg", theme.fg("text", submitText))
          : theme.fg(allAnswered() ? "success" : "dim", submitText);
      tabs.push(`${submitStyled} →`);
      add(` ${tabs.join("")}`);
      lines.push("");
    }
    if (inputMode && question) {
      add(theme.fg("text", ` ${question.prompt}`));
      lines.push("");
      options.forEach((option, index) =>
        add(
          `${option.isOther && inputMode ? theme.fg("accent", `> ${index + 1}. ${option.label} ✎`) : `  ${index + 1}. ${option.label}`}`,
        ),
      );
      lines.push("");
      add(theme.fg("muted", " Your answer:"));
      for (const line of editor.render(width - 2)) add(` ${line}`);
      lines.push("");
      add(theme.fg("dim", " Enter to submit • Esc to cancel"));
    } else if (currentTab === questions.length) {
      add(theme.fg("accent", theme.bold(" Ready to submit")));
      lines.push("");
      for (const q of questions) {
        const answer = answers.get(q.id);
        if (answer)
          add(
            `${theme.fg("muted", ` ${q.label}: `)}${theme.fg("text", formatRenderedAnswer(answer))}`,
          );
      }
      lines.push("");
      add(
        allAnswered()
          ? theme.fg("success", " Press Enter to submit")
          : theme.fg(
              "warning",
              ` Unanswered: ${questions
                .filter((q) => !hasAnswer(q.id))
                .map((q) => q.label)
                .join(", ")}`,
            ),
      );
    } else if (question) {
      add(theme.fg("text", ` ${question.prompt}`));
      lines.push("");
      options.forEach((option, index) => {
        const selected = index === optionIndex;
        const answer = question ? answers.get(question.id) : undefined;
        const isSelected = !!answer && answer.values.includes(option.value);
        const prefix = selected ? theme.fg("accent", "> ") : "  ";
        const color = selected ? "accent" : isSelected ? "success" : "text";
        add(
          prefix +
            theme.fg(
              color,
              `${isSelected ? "✓ " : ""}${index + 1}. ${option.label}`,
            ),
        );
        if (option.description)
          add(`     ${theme.fg("muted", option.description)}`);
      });
    }
    lines.push("");
    if (!inputMode)
      add(
        theme.fg(
          "dim",
          question?.multiple
            ? isMulti
              ? " Tab/←→ navigate • ↑↓ select • Enter toggle • choose Done / continue when finished • Esc cancel"
              : " ↑↓ navigate • Enter toggle • choose Done / continue when finished • Esc cancel"
            : isMulti
              ? " Tab/←→ navigate • ↑↓ select • Enter confirm • Esc cancel"
              : " ↑↓ navigate • Enter select • Esc cancel",
        ),
      );
    add(theme.fg("accent", "─".repeat(width)));
    cachedLines = lines;
    return lines;
  };

  return {
    render,
    invalidate: () => {
      cachedLines = undefined;
    },
    handleInput,
  };
}
