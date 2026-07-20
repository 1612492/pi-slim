import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { normalizeQuestions, errorResult } from "./normalize.ts";
import type { Question, QuestionnaireResult } from "./types.ts";
import { QuestionnaireParams } from "./types.ts";
import { formatAnswers, formatRenderedAnswer } from "./format.ts";
import { createQuestionnaireController } from "./controller.ts";

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

      const questions = normalizeQuestions(params.questions as Question[]);

      const result = await ctx.ui.custom<QuestionnaireResult>(
        (tui, theme, _kb, done) =>
          createQuestionnaireController(questions, theme, tui, done),
      );

      if (result.cancelled) {
        return {
          content: [{ type: "text", text: "User cancelled the questionnaire" }],
          details: result,
        };
      }

      const answerLines = formatAnswers(result);

      return {
        content: [{ type: "text", text: answerLines }],
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
        const display = formatRenderedAnswer(answer);
        return `${theme.fg("success", "✓ ")}${theme.fg("accent", answer.id)}: ${display}`;
      });
      return new Text(lines.join("\n"), 0, 0);
    },
  });
}
