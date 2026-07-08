import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import questionnaireExtension from "./index.ts";

type RegisteredTool = {
  name: string;
  execute: (...args: any[]) => Promise<any>;
  renderCall: (...args: any[]) => any;
  renderResult: (...args: any[]) => any;
};

function setupExtension() {
  let tool: RegisteredTool | undefined;

  const pi = {
    registerTool: vi.fn((definition: RegisteredTool) => {
      tool = definition;
    }),
  } as unknown as ExtensionAPI;

  questionnaireExtension(pi);

  if (!tool) {
    throw new Error("questionnaire tool was not registered");
  }

  return { tool };
}

function createTheme() {
  return {
    fg: vi.fn((_tone: string, text: string) => text),
    bg: vi.fn((_tone: string, text: string) => text),
    bold: vi.fn((text: string) => text),
  };
}

describe("questionnaire extension", () => {
  it("returns an error when UI is unavailable", async () => {
    const { tool } = setupExtension();

    const result = await tool.execute(
      "1",
      {
        questions: [
          {
            id: "scope",
            prompt: "Choose scope",
            options: [{ value: "small", label: "Small" }],
          },
        ],
      },
      undefined,
      undefined,
      { hasUI: false } as never,
    );

    expect(result.content[0]?.text).toBe(
      "Error: UI not available (running in non-interactive mode)",
    );
    expect(result.details).toEqual({
      questions: [],
      answers: [],
      cancelled: true,
    });
  });

  it("returns an error when no questions are provided", async () => {
    const { tool } = setupExtension();

    const result = await tool.execute(
      "1",
      { questions: [] },
      undefined,
      undefined,
      { hasUI: true } as never,
    );

    expect(result.content[0]?.text).toBe("Error: No questions provided");
    expect(result.details).toEqual({
      questions: [],
      answers: [],
      cancelled: true,
    });
  });

  it("formats selected and custom answers from the UI result", async () => {
    const { tool } = setupExtension();
    const custom = vi.fn().mockResolvedValue({
      questions: [
        {
          id: "scope",
          label: "Q1",
          prompt: "Choose scope",
          options: [{ value: "small", label: "Small" }],
          allowOther: true,
        },
        {
          id: "priority",
          label: "Priority",
          prompt: "Choose priority",
          options: [{ value: "high", label: "High" }],
          allowOther: true,
        },
      ],
      answers: [
        {
          id: "scope",
          values: ["small"],
          labels: ["Small"],
          selectedIndices: [1],
        },
        {
          id: "priority",
          values: [],
          labels: [],
          custom: "urgent",
        },
      ],
      cancelled: false,
    });

    const result = await tool.execute(
      "1",
      {
        questions: [
          {
            id: "scope",
            prompt: "Choose scope",
            options: [{ value: "small", label: "Small" }],
          },
          {
            id: "priority",
            label: "Priority",
            prompt: "Choose priority",
            options: [{ value: "high", label: "High" }],
            allowOther: false,
          },
        ],
      },
      undefined,
      undefined,
      {
        hasUI: true,
        ui: { custom },
      } as never,
    );

    expect(custom).toHaveBeenCalledOnce();
    expect(custom.mock.calls[0]?.[0]).toBeTypeOf("function");
    expect(result.content[0]?.text).toBe(
      "Q1: selected: 1. Small\nPriority: wrote: urgent",
    );
    expect(result.details.cancelled).toBe(false);
  });

  it("returns a cancellation message when the questionnaire is cancelled", async () => {
    const { tool } = setupExtension();

    const result = await tool.execute(
      "1",
      {
        questions: [
          {
            id: "scope",
            prompt: "Choose scope",
            options: [{ value: "small", label: "Small" }],
          },
        ],
      },
      undefined,
      undefined,
      {
        hasUI: true,
        ui: {
          custom: vi.fn().mockResolvedValue({
            questions: [],
            answers: [],
            cancelled: true,
          }),
        },
      } as never,
    );

    expect(result.content[0]?.text).toBe("User cancelled the questionnaire");
    expect(result.details.cancelled).toBe(true);
  });

  it("renderCall shows tool name, count, and labels", () => {
    const { tool } = setupExtension();
    const theme = createTheme();

    const rendered = tool.renderCall(
      {
        questions: [
          { id: "scope", label: "Scope" },
          { id: "priority", label: "Priority" },
        ],
      },
      theme,
    );

    expect(rendered.text).toContain("questionnaire ");
    expect(rendered.text).toContain("2 questions");
    expect(rendered.text).toContain("Scope, Priority");
  });

  it("renderResult falls back to plain text when details are absent", () => {
    const { tool } = setupExtension();
    const theme = createTheme();

    const rendered = tool.renderResult(
      {
        content: [{ type: "text", text: "plain result" }],
      },
      {},
      theme,
    );

    expect(rendered.text).toBe("plain result");
  });

  it("renderResult shows cancelled state", () => {
    const { tool } = setupExtension();
    const theme = createTheme();

    const rendered = tool.renderResult(
      {
        content: [{ type: "text", text: "ignored" }],
        details: { questions: [], answers: [], cancelled: true },
      },
      {},
      theme,
    );

    expect(rendered.text).toBe("Cancelled");
  });

  it("renderResult formats selected and custom answers", () => {
    const { tool } = setupExtension();
    const theme = createTheme();

    const rendered = tool.renderResult(
      {
        content: [{ type: "text", text: "ignored" }],
        details: {
          questions: [],
          cancelled: false,
          answers: [
            {
              id: "scope",
              values: ["small"],
              labels: ["Small"],
              selectedIndices: [1],
            },
            {
              id: "priority",
              values: [],
              labels: [],
              custom: "urgent",
            },
          ],
        },
      },
      {},
      theme,
    );

    expect(rendered.text).toContain("✓ scope: 1. Small");
    expect(rendered.text).toContain("✓ priority: (wrote) urgent");
  });

  it("renderResult formats multi-select answers", () => {
    const { tool } = setupExtension();
    const theme = createTheme();

    const rendered = tool.renderResult(
      {
        content: [{ type: "text", text: "ignored" }],
        details: {
          questions: [],
          cancelled: false,
          answers: [
            {
              id: "scope",
              values: ["small", "medium"],
              labels: ["Small", "Medium"],
              selectedIndices: [1, 2],
              custom: "large-ish",
            },
          ],
        },
      },
      {},
      theme,
    );

    expect(rendered.text).toContain(
      "✓ scope: 1. Small, 2. Medium, (wrote) large-ish",
    );
  });
});
