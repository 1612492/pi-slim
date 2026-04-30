import { describe, expect, it, vi } from "vitest";
import {
  buildPiSubagentInvocation,
  extractFinalTextFromPiJsonl,
} from "./child-pi.js";

describe("child pi runner helpers", () => {
  it("builds json-mode child pi invocation", () => {
    vi.stubEnv("PI_SUBAGENT_BIN", "pi-local");

    const invocation = buildPiSubagentInvocation({
      definition: {
        name: "explorer",
        description: "Local recon",
        tools: ["read", "grep", "find", "ls"],
        systemPrompt: "You are explorer.",
      },
      task: "Trace cache usage",
      contextFiles: ["README.md", "extensions/index.ts"],
      model: "openai/gpt-5.4",
      cwd: "/tmp/demo",
    });

    expect(invocation).toEqual({
      command: "pi-local",
      args: [
        "--mode",
        "json",
        "--no-session",
        "--system-prompt",
        "You are explorer.",
        "--tools",
        "read,grep,find,ls",
        "--model",
        "openai/gpt-5.4",
        "Trace cache usage\n\nUse these file paths as starting context. Read only what you need:\n- README.md\n- extensions/index.ts",
      ],
      cwd: "/tmp/demo",
    });
  });

  it("extracts the last assistant message text from jsonl", () => {
    const stdout = [
      JSON.stringify({ type: "session", id: "1" }),
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "first" }],
        },
      }),
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "second" },
            { type: "text", text: "result" },
          ],
        },
      }),
    ].join("\n");

    expect(extractFinalTextFromPiJsonl(stdout)).toBe("second\n\nresult");
  });
});
