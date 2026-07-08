import { describe, expect, it } from "vitest";
import { isSafeCommand } from "./utils.ts";

describe("plan-mode utils", () => {
  it("allows read-only commands and blocks destructive ones", () => {
    expect(isSafeCommand("git diff --stat")).toBe(true);
    expect(isSafeCommand("npm install")).toBe(false);
    expect(isSafeCommand("cat file.txt > out.txt")).toBe(false);
  });
});
