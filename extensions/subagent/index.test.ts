import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("./utils.ts", () => ({
  discoverAgents: vi.fn(() => ({
    agents: [
      {
        name: "fixer",
        source: "builtin",
        description: "Fixer",
        systemPrompt: "",
        tools: [],
      },
    ],
    builtInAgentsDir: "/package/agents",
  })),
}));

import subagentExtension from "./index.ts";

function makeProc() {
  const stdout = new EventEmitter() as EventEmitter & {
    setEncoding: () => void;
  };
  const stderr = new EventEmitter() as EventEmitter & {
    setEncoding: () => void;
  };
  stdout.setEncoding = vi.fn();
  stderr.setEncoding = vi.fn();
  const proc = new EventEmitter() as EventEmitter & {
    stdout: typeof stdout;
    stderr: typeof stderr;
  };
  proc.stdout = stdout;
  proc.stderr = stderr;
  return proc;
}

function registerTool() {
  let tool: any;
  const pi = {
    registerTool: vi.fn((definition: any) => {
      tool = definition;
    }),
  } as unknown as ExtensionAPI;
  subagentExtension(pi);
  return tool;
}

function emitJson(proc: ReturnType<typeof makeProc>, line: unknown) {
  proc.stdout.emit("data", `${JSON.stringify(line)}\n`);
}

describe("subagent permission retry", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("prompts and retries once after a no-UI permission-required child failure", async () => {
    const tool = registerTool();
    const first = makeProc();
    const second = makeProc();
    spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);

    const ctx = {
      cwd: "/repo",
      hasUI: true,
      ui: { confirm: vi.fn().mockResolvedValue(true) },
    };

    const resultPromise = tool.execute(
      "1",
      { agent: "fixer", task: "read file" },
      undefined,
      undefined,
      ctx,
    );

    emitJson(first, {
      type: "response_end",
      errorMessage:
        'PERMISSION_REQUIRED:{"kind":"outside-cwd","path":"/repo/secret.txt"}',
    });
    first.emit("close", 1);

    await new Promise((resolve) => setTimeout(resolve, 0));

    emitJson(second, {
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
    });
    emitJson(second, { type: "response_end" });
    second.emit("close", 0);

    const result = await resultPromise;

    expect(ctx.ui.confirm).toHaveBeenCalledOnce();
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock.mock.calls[1][2].env.PI_PERMISSION_GATE_OVERRIDE).toBe(
      JSON.stringify({ kind: "outside-cwd", path: "/repo/secret.txt" }),
    );
    expect(result.content[0]?.text).toBe("ok");
  });

  it("preflights explicit outside-cwd paths before first spawn", async () => {
    const tool = registerTool();
    const proc = makeProc();
    spawnMock.mockReturnValueOnce(proc);

    const ctx = {
      cwd: "/repo",
      hasUI: true,
      ui: { confirm: vi.fn().mockResolvedValue(true) },
    };

    const resultPromise = tool.execute(
      "1",
      { agent: "fixer", task: "inspect ~/.pi/agent/settings.json" },
      undefined,
      undefined,
      ctx,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    emitJson(proc, {
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
    });
    emitJson(proc, { type: "response_end" });
    proc.emit("close", 0);

    const result = await resultPromise;

    expect(ctx.ui.confirm).toHaveBeenCalledOnce();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0][2].env.PI_PERMISSION_GATE_OVERRIDE).toBe(
      JSON.stringify({
        kind: "outside-cwd",
        path: "/Users/eric/.pi/agent/settings.json",
      }),
    );
    expect(result.content[0]?.text).toBe("ok");
  });

  it("preflights explicit sensitive paths before first spawn", async () => {
    const tool = registerTool();
    const proc = makeProc();
    spawnMock.mockReturnValueOnce(proc);

    const ctx = {
      cwd: "/repo",
      hasUI: true,
      ui: { confirm: vi.fn().mockResolvedValue(true) },
    };

    const resultPromise = tool.execute(
      "1",
      { agent: "fixer", task: "inspect .env.local" },
      undefined,
      undefined,
      ctx,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    emitJson(proc, {
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
    });
    emitJson(proc, { type: "response_end" });
    proc.emit("close", 0);

    await resultPromise;

    expect(ctx.ui.confirm).toHaveBeenCalledOnce();
    expect(spawnMock.mock.calls[0][2].env.PI_PERMISSION_GATE_OVERRIDE).toBe(
      JSON.stringify({ kind: "sensitive-file", path: "/repo/.env.local" }),
    );
  });

  it("does not prompt for unrelated tasks", async () => {
    const tool = registerTool();
    const proc = makeProc();
    spawnMock.mockReturnValueOnce(proc);

    const ctx = {
      cwd: "/repo",
      hasUI: true,
      ui: { confirm: vi.fn().mockResolvedValue(true) },
    };

    const resultPromise = tool.execute(
      "1",
      { agent: "fixer", task: "summarize src/index.ts" },
      undefined,
      undefined,
      ctx,
    );

    emitJson(proc, {
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
    });
    emitJson(proc, { type: "response_end" });
    proc.emit("close", 0);

    await resultPromise;

    expect(ctx.ui.confirm).not.toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(
      spawnMock.mock.calls[0][2].env.PI_PERMISSION_GATE_OVERRIDE,
    ).toBeUndefined();
  });

  it("prompts when raw permission-required metadata appears before prose summary", async () => {
    const tool = registerTool();
    const first = makeProc();
    const second = makeProc();
    spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);

    const ctx = {
      cwd: "/repo",
      hasUI: true,
      ui: { confirm: vi.fn().mockResolvedValue(true) },
    };

    const resultPromise = tool.execute(
      "1",
      { agent: "fixer", task: "read file" },
      undefined,
      undefined,
      ctx,
    );

    emitJson(first, {
      type: "tool_result",
      content: [
        {
          type: "text",
          text: 'PERMISSION_REQUIRED:{"kind":"outside-cwd","path":"/repo/secret.txt"}',
        },
      ],
      isError: true,
    });
    emitJson(first, {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Access issue: read blocked" }],
      },
    });
    emitJson(first, { type: "response_end" });
    first.emit("close", 1);

    await new Promise((resolve) => setTimeout(resolve, 0));

    emitJson(second, {
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
    });
    emitJson(second, { type: "response_end" });
    second.emit("close", 0);

    const result = await resultPromise;

    expect(ctx.ui.confirm).toHaveBeenCalledOnce();
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(result.content[0]?.text).toBe("ok");
  });

  it("blocks when the parent denies retry approval", async () => {
    const tool = registerTool();
    const first = makeProc();
    spawnMock.mockReturnValueOnce(first);

    const ctx = {
      cwd: "/repo",
      hasUI: true,
      ui: { confirm: vi.fn().mockResolvedValue(false) },
    };

    const resultPromise = tool.execute(
      "1",
      { agent: "fixer", task: "read file" },
      undefined,
      undefined,
      ctx,
    );

    emitJson(first, {
      type: "response_end",
      errorMessage:
        'PERMISSION_REQUIRED:{"kind":"sensitive-file","path":"/repo/.env.local"}',
    });
    first.emit("close", 1);

    const result = await resultPromise;

    expect(ctx.ui.confirm).toHaveBeenCalledOnce();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("PERMISSION_REQUIRED");
  });

  it("does not retry when the child failure is unrelated", async () => {
    const tool = registerTool();
    const first = makeProc();
    spawnMock.mockReturnValueOnce(first);

    const ctx = {
      cwd: "/repo",
      hasUI: true,
      ui: { confirm: vi.fn() },
    };

    const resultPromise = tool.execute(
      "1",
      { agent: "fixer", task: "read file" },
      undefined,
      undefined,
      ctx,
    );

    emitJson(first, {
      type: "response_end",
      errorMessage: "some other error",
    });
    first.emit("close", 1);

    const result = await resultPromise;

    expect(ctx.ui.confirm).not.toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(result.content[0]?.text).toContain("some other error");
  });
});
