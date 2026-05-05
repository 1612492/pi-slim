import { describe, expect, it } from "vitest";
import {
  extractDoneSteps,
  extractTodoItems,
  isSafeCommand,
  markCompletedSteps,
} from "./utils.js";

describe("plan-mode utils", () => {
  it("allows read-only commands and blocks destructive ones", () => {
    expect(isSafeCommand("git diff --stat")).toBe(true);
    expect(isSafeCommand("npm install")).toBe(false);
    expect(isSafeCommand("cat file.txt > out.txt")).toBe(false);
  });

  it("extracts numbered plan items", () => {
    const items = extractTodoItems(
      `Plan:\n1. Inspect the cache layer\n2. Update the subagent flow\n3. Run tests`,
    );
    expect(items.map((item) => item.text)).toEqual([
      "Inspect the cache layer",
      "Subagent flow",
      "Tests",
    ]);
  });

  it("tracks done markers", () => {
    const items = extractTodoItems(
      `Plan:\n1. Inspect the cache layer\n2. Update the subagent flow`,
    );
    expect(extractDoneSteps("Completed [DONE:2] and [DONE:1]")).toEqual([2, 1]);
    expect(markCompletedSteps("Completed [DONE:2] and [DONE:1]", items)).toBe(
      2,
    );
    expect(items.every((item) => item.completed)).toBe(true);
  });
});
