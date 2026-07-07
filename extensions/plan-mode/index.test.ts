import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import planModeExtension from "./index.js";

function setupExtension() {
  const handlers = new Map<
    string,
    (event?: unknown, ctx?: unknown) => Promise<unknown> | unknown
  >();

  const pi = {
    registerFlag: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
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
      notify: vi.fn(),
    },
    sessionManager: {
      getEntries: vi.fn(() => []),
    },
  };

  planModeExtension(pi);

  return { handlers, pi, ctx };
}

describe("plan-mode extension", () => {
  it("injects OpenCode-style planning guidance in plan mode", async () => {
    const { handlers, ctx } = setupExtension();

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
    expect(content).toContain("Plan:\n1. First step description");
  });

  it("does not register extra post-plan event handlers", () => {
    const { handlers } = setupExtension();

    expect(handlers.has("turn_end")).toBe(false);
    expect(handlers.has("agent_end")).toBe(false);
  });

  it("notifies when plan mode is disabled at session start", async () => {
    const { handlers, ctx, pi } = setupExtension();

    pi.getFlag = vi.fn(() => false);

    await handlers.get("session_start")?.({}, ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Plan mode disabled");
  });
});
