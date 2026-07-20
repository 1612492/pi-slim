import type { QuestionAnswer, QuestionnaireResult } from "./types.ts";

export function formatAnswers(result: QuestionnaireResult): string {
  return result.answers
    .map((answer) => {
      const questionLabel =
        result.questions.find((question) => question.id === answer.id)?.label ||
        answer.id;
      const parts = [
        ...answer.labels.map(
          (label, index) =>
            `selected: ${answer.selectedIndices?.[index] ?? index + 1}. ${label}`,
        ),
        ...(answer.custom ? [`wrote: ${answer.custom}`] : []),
      ];
      return `${questionLabel}: ${parts.join("; ")}`;
    })
    .join("\n");
}

export function formatRenderedAnswer(answer: QuestionAnswer): string {
  return [
    ...answer.labels.map(
      (label, index) =>
        `${answer.selectedIndices?.[index] ?? index + 1}. ${label}`,
    ),
    ...(answer.custom ? [`(wrote) ${answer.custom}`] : []),
  ].join(", ");
}
