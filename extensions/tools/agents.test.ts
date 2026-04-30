import { describe, expect, it } from "vitest";
import {
  getBuiltInSubagentPath,
  parseBuiltInSubagentDefinition,
} from "./agents.js";

describe("built-in subagent definitions", () => {
  it("parses frontmatter and prompt body", () => {
    const definition = parseBuiltInSubagentDefinition(`---
name: explorer
description: Local recon
tools: read, grep, find, ls
---

Be concise.
`);

    expect(definition).toEqual({
      name: "explorer",
      description: "Local recon",
      tools: ["read", "grep", "find", "ls"],
      systemPrompt: "Be concise.",
    });
  });

  it("resolves built-in agent asset paths", () => {
    expect(getBuiltInSubagentPath("explorer")).toMatch(/agents\/explorer\.md$/);
    expect(getBuiltInSubagentPath("librarian")).toMatch(
      /agents\/librarian\.md$/,
    );
  });
});
