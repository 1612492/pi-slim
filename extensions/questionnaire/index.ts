import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  Text,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

interface QuestionOption {
  value: string;
  label: string;
  description?: string;
}

type RenderOption = QuestionOption & { isOther?: boolean };

type QuestionAnswer = {
  id: string;
  values: string[];
  labels: string[];
  custom?: string;
  selectedIndices?: number[];
};

interface Question {
  id: string;
  label: string;
  prompt: string;
  options: QuestionOption[];
  allowOther: boolean;
  multiple: boolean;
}

interface QuestionnaireResult {
  questions: Question[];
  answers: QuestionAnswer[];
  cancelled: boolean;
}

const QuestionOptionSchema = Type.Object({
  value: Type.String({ description: "The value returned when selected" }),
  label: Type.String({ description: "Display label for the option" }),
  description: Type.Optional(
    Type.String({ description: "Optional description shown below label" }),
  ),
});

const QuestionSchema = Type.Object({
  id: Type.String({ description: "Unique identifier for this question" }),
  label: Type.Optional(
    Type.String({
      description:
        "Short contextual label for tab bar, e.g. 'Scope', 'Priority' (defaults to Q1, Q2)",
    }),
  ),
  prompt: Type.String({ description: "The full question text to display" }),
  options: Type.Array(QuestionOptionSchema, {
    description: "Available options to choose from",
  }),
  allowOther: Type.Optional(
    Type.Boolean({
      description: "Allow 'Type something' option (default: true)",
    }),
  ),
  multiple: Type.Optional(
    Type.Boolean({
      description: "Allow multiple selected options (default: false)",
    }),
  ),
});

const QuestionnaireParams = Type.Object({
  questions: Type.Array(QuestionSchema, {
    description: "Questions to ask the user",
  }),
});

function errorResult(
  message: string,
  questions: Question[] = [],
): { content: { type: "text"; text: string }[]; details: QuestionnaireResult } {
  return {
    content: [{ type: "text", text: message }],
    details: { questions, answers: [], cancelled: true },
  };
}

export default function questionnaireExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "questionnaire",
    label: "Questionnaire",
    description:
      "Ask the user one or more questions. Use for clarifying requirements, getting preferences, or confirming decisions.",
    parameters: QuestionnaireParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        return errorResult(
          "Error: UI not available (running in non-interactive mode)",
        );
      }
      if (params.questions.length === 0) {
        return errorResult("Error: No questions provided");
      }

      const questions: Question[] = params.questions.map((question, index) => ({
        ...question,
        label: question.label || `Q${index + 1}`,
        allowOther: question.allowOther !== false,
        multiple: question.multiple === true,
      }));

      const isMulti = questions.length > 1;
      const totalTabs = questions.length + 1;

      const result = await ctx.ui.custom<QuestionnaireResult>(
        (tui, theme, _kb, done) => {
          let currentTab = 0;
          let optionIndex = 0;
          let inputMode = false;
          let inputQuestionId: string | null = null;
          let cachedLines: string[] | undefined;
          const answers = new Map<string, QuestionAnswer>();

          const editorTheme: EditorTheme = {
            borderColor: (segment) => theme.fg("accent", segment),
            selectList: {
              selectedPrefix: (text) => theme.fg("accent", text),
              selectedText: (text) => theme.fg("accent", text),
              description: (text) => theme.fg("muted", text),
              scrollInfo: (text) => theme.fg("dim", text),
              noMatch: (text) => theme.fg("warning", text),
            },
          };
          const editor = new Editor(tui, editorTheme);

          function refresh() {
            cachedLines = undefined;
            tui.requestRender();
          }

          function submit(cancelled: boolean) {
            done({
              questions,
              answers: Array.from(answers.values()),
              cancelled,
            });
          }

          function currentQuestion(): Question | undefined {
            return questions[currentTab];
          }

          function currentOptions(): RenderOption[] {
            const question = currentQuestion();
            if (!question) return [];
            const options: RenderOption[] = [...question.options];
            if (question.multiple) {
              options.push({ value: "__done__", label: "Done / continue" });
            }
            if (question.allowOther) {
              options.push({
                value: "__other__",
                label: "Type something.",
                isOther: true,
              });
            }
            return options;
          }

          function advanceAfterAnswer() {
            if (!isMulti) {
              submit(false);
              return;
            }
            if (currentTab < questions.length - 1) {
              currentTab++;
            } else {
              currentTab = questions.length;
            }
            optionIndex = 0;
            refresh();
          }

          function saveAnswer(questionId: string, answer: QuestionAnswer) {
            answers.set(questionId, answer);
          }

          function currentAnswer(questionId: string): QuestionAnswer {
            return (
              answers.get(questionId) || {
                id: questionId,
                values: [],
                labels: [],
              }
            );
          }

          function hasAnswer(questionId: string): boolean {
            const answer = answers.get(questionId);
            return !!answer && (answer.values.length > 0 || !!answer.custom);
          }

          function allAnswered(): boolean {
            return questions.every((question) => hasAnswer(question.id));
          }

          function toggleOption(
            question: Question,
            option: RenderOption,
            index: number,
          ) {
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
          }

          function finalizeMulti(question: Question) {
            const answer = answers.get(question.id);
            if (!answer || (answer.values.length === 0 && !answer.custom))
              return;
            advanceAfterAnswer();
          }

          editor.onSubmit = (value) => {
            if (!inputQuestionId) return;
            const questionId = inputQuestionId;
            const trimmed = value.trim() || "(no response)";
            const existing = currentAnswer(questionId);
            saveAnswer(questionId, {
              ...existing,
              id: questionId,
              custom: trimmed,
            });
            inputMode = false;
            const question = questions.find((q) => q.id === questionId);
            inputQuestionId = null;
            editor.setText("");
            if (question?.multiple) {
              refresh();
            } else {
              advanceAfterAnswer();
            }
          };

          function handleInput(data: string) {
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
              if (
                matchesKey(data, Key.shift("tab")) ||
                matchesKey(data, Key.left)
              ) {
                currentTab = (currentTab - 1 + totalTabs) % totalTabs;
                optionIndex = 0;
                refresh();
                return;
              }
            }

            if (currentTab === questions.length) {
              if (matchesKey(data, Key.enter) && allAnswered()) {
                submit(false);
              } else if (matchesKey(data, Key.escape)) {
                submit(true);
              }
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
              if (option.value === "__done__" && question.multiple) {
                finalizeMulti(question);
                return;
              }
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

            if (matchesKey(data, Key.escape)) {
              submit(true);
            }
          }

          function render(width: number): string[] {
            if (cachedLines) return cachedLines;

            const lines: string[] = [];
            const question = currentQuestion();
            const options = currentOptions();
            const add = (text: string) =>
              lines.push(truncateToWidth(text, width));

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
              const canSubmit = allAnswered();
              const isSubmitTab = currentTab === questions.length;
              const submitText = " ✓ Submit ";
              const submitStyled = isSubmitTab
                ? theme.bg("selectedBg", theme.fg("text", submitText))
                : theme.fg(canSubmit ? "success" : "dim", submitText);
              tabs.push(`${submitStyled} →`);
              add(` ${tabs.join("")}`);
              lines.push("");
            }

            function renderOptions() {
              for (let index = 0; index < options.length; index++) {
                const option = options[index];
                const selected = index === optionIndex;
                const isOther = option.isOther === true;
                const answer = question ? answers.get(question.id) : undefined;
                const isSelected =
                  !!answer && answer.values.includes(option.value);
                const prefix = selected ? theme.fg("accent", "> ") : "  ";
                const color = selected
                  ? "accent"
                  : isSelected
                    ? "success"
                    : "text";
                if (isOther && inputMode) {
                  add(
                    prefix +
                      theme.fg("accent", `${index + 1}. ${option.label} ✎`),
                  );
                } else {
                  add(
                    prefix +
                      theme.fg(
                        color,
                        `${isSelected ? "✓ " : ""}${index + 1}. ${option.label}`,
                      ),
                  );
                }
                if (option.description) {
                  add(`     ${theme.fg("muted", option.description)}`);
                }
              }
            }

            if (inputMode && question) {
              add(theme.fg("text", ` ${question.prompt}`));
              lines.push("");
              renderOptions();
              lines.push("");
              add(theme.fg("muted", " Your answer:"));
              for (const line of editor.render(width - 2)) {
                add(` ${line}`);
              }
              lines.push("");
              add(theme.fg("dim", " Enter to submit • Esc to cancel"));
            } else if (currentTab === questions.length) {
              add(theme.fg("accent", theme.bold(" Ready to submit")));
              lines.push("");
              for (const questionItem of questions) {
                const answer = answers.get(questionItem.id);
                if (answer) {
                  const items = [
                    ...answer.labels.map(
                      (label, idx) =>
                        `${answer.selectedIndices?.[idx] ?? idx + 1}. ${label}`,
                    ),
                    ...(answer.custom ? [`(wrote) ${answer.custom}`] : []),
                  ];
                  add(
                    `${theme.fg("muted", ` ${questionItem.label}: `)}${theme.fg("text", items.join(", "))}`,
                  );
                }
              }
              lines.push("");
              if (allAnswered()) {
                add(theme.fg("success", " Press Enter to submit"));
              } else {
                const missing = questions
                  .filter((questionItem) => !hasAnswer(questionItem.id))
                  .map((questionItem) => questionItem.label)
                  .join(", ");
                add(theme.fg("warning", ` Unanswered: ${missing}`));
              }
            } else if (question) {
              add(theme.fg("text", ` ${question.prompt}`));
              lines.push("");
              renderOptions();
            }

            lines.push("");
            if (!inputMode) {
              const help = question?.multiple
                ? isMulti
                  ? " Tab/←→ navigate • ↑↓ select • Enter toggle • choose Done / continue when finished • Esc cancel"
                  : " ↑↓ navigate • Enter toggle • choose Done / continue when finished • Esc cancel"
                : isMulti
                  ? " Tab/←→ navigate • ↑↓ select • Enter confirm • Esc cancel"
                  : " ↑↓ navigate • Enter select • Esc cancel";
              add(theme.fg("dim", help));
            }
            add(theme.fg("accent", "─".repeat(width)));

            cachedLines = lines;
            return lines;
          }

          return {
            render,
            invalidate: () => {
              cachedLines = undefined;
            },
            handleInput,
          };
        },
      );

      if (result.cancelled) {
        return {
          content: [{ type: "text", text: "User cancelled the questionnaire" }],
          details: result,
        };
      }

      const answerLines = result.answers.map((answer) => {
        const questionLabel =
          questions.find((question) => question.id === answer.id)?.label ||
          answer.id;
        const parts = [
          ...answer.labels.map(
            (label, index) =>
              `selected: ${answer.selectedIndices?.[index] ?? index + 1}. ${label}`,
          ),
          ...(answer.custom ? [`wrote: ${answer.custom}`] : []),
        ];
        return `${questionLabel}: ${parts.join("; ")}`;
      });

      return {
        content: [{ type: "text", text: answerLines.join("\n") }],
        details: result,
      };
    },

    renderCall(args, theme) {
      const questions = (args.questions as Question[]) || [];
      const count = questions.length;
      const labels = questions
        .map((question) => question.label || question.id)
        .join(", ");
      let text = theme.fg("toolTitle", theme.bold("questionnaire "));
      text += theme.fg("muted", `${count} question${count !== 1 ? "s" : ""}`);
      if (labels) {
        text += theme.fg("dim", ` (${truncateToWidth(labels, 40)})`);
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme) {
      const details = result.details as QuestionnaireResult | undefined;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }
      if (details.cancelled) {
        return new Text(theme.fg("warning", "Cancelled"), 0, 0);
      }
      const lines = details.answers.map((answer) => {
        const display = [
          ...answer.labels.map(
            (label, index) =>
              `${answer.selectedIndices?.[index] ?? index + 1}. ${label}`,
          ),
          ...(answer.custom ? [`(wrote) ${answer.custom}`] : []),
        ].join(", ");
        return `${theme.fg("success", "✓ ")}${theme.fg("accent", answer.id)}: ${display}`;
      });
      return new Text(lines.join("\n"), 0, 0);
    },
  });
}
