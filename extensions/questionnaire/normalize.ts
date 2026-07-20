import type { Question } from "./types.ts";

export function normalizeQuestions(input: Question[]): Question[] {
  return input.map((question, index) => ({
    ...question,
    label: question.label || `Q${index + 1}`,
    allowOther: question.allowOther !== false,
    multiple: question.multiple === true,
  }));
}

export function errorResult(message: string, questions: Question[] = []) {
  return {
    content: [{ type: "text" as const, text: message }],
    details: { questions, answers: [], cancelled: true },
  };
}
