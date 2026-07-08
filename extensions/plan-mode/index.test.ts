import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import planModeExtension from "./index.ts";

function setupExtension() {
  const handlers = new Map<
    string,
    (event?: unknown, ctx?: unknown) => Promise<unknown> | unknown
  >();
  const shortcuts = new Map<string, (ctx?: unknown) => unknown>();

  const pi = {
    registerFlag: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(
      (key: string, config: { handler: (ctx?: unknown) => unknown }) => {
        shortcuts.set(key, config.handler);
      },
    ),
    on: vi.fn(
      (name: string, handler: (event?: unknown, ctx?: unknown) => unknown) => {
        handlers.set(name, handler);
      },
    ),
    appendEntry: vi.fn(),
    getActiveTools: vi.fn(() => []),
    getAllTools: vi.fn(() => []),
    setActiveTools: vi.fn(),
    sendMessage: vi.fn(),
    getFlag: vi.fn(() => true),
  } as unknown as ExtensionAPI;

  const ctx = {
    hasUI: true,
    ui: {
      theme: {
        fg: vi.fn((_color: string, text: string) => text),
      },
      setStatus: vi.fn(),
      notify: vi.fn(),
    },
    sessionManager: {
      getEntries: vi.fn(() => []),
    },
  };

  planModeExtension(pi);

  return { handlers, shortcuts, pi, ctx };
}

describe("plan-mode extension", () => {
  it("injects OpenCode-style planning guidance in plan mode", async () => {
    const { handlers, shortcuts, ctx } = setupExtension();

    await shortcuts.get("ctrl+\\")?.(ctx);
    await handlers.get("session_start")?.({}, ctx);
    const result = await handlers.get("before_agent_start")?.();
    const content = (result as { message?: { content?: string } })?.message
      ?.content;

    expect(content).toContain(
      "CRITICAL: Plan mode ACTIVE - you are in READ-ONLY phase",
    );
    expect(content).toContain(
      "Your current responsibility is to think, read, search",
    );
    expect(content).toContain(
      '"explorer" for local code discovery, "librarian" for docs/research, and',
    );
    expect(content).toContain(
      '"oracle" for analysis/review. Use "fixer" for build mode / implementation, not',
    );
    expect(content).not.toContain(
      'Use "fixer" for build mode / implementation, not plan mode.',
    );
    expect(content).toContain("Plan:\n1. First step description");
  });

  it("includes subagent in the plan mode tool allowlist", async () => {
    const { shortcuts, pi, ctx } = setupExtension();

    await shortcuts.get("ctrl+\\")?.(ctx);

    expect(pi.setActiveTools).toHaveBeenCalledWith(
      expect.arrayContaining(["subagent"]),
    );
  });

  it("does not register extra post-plan event handlers", () => {
    const { handlers } = setupExtension();

    expect(handlers.has("turn_end")).toBe(false);
    expect(handlers.has("agent_end")).toBe(false);
  });

  it("shows build mode status when plan mode is disabled at session start", async () => {
    const { handlers, ctx, pi } = setupExtension();

    pi.getFlag = vi.fn(() => false);

    await handlers.get("session_start")?.({}, ctx);

    expect(ctx.ui.setStatus).toHaveBeenCalledWith("plan-mode", "BUILD MODE");
  });
});
