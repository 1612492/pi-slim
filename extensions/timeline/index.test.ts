import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { copyToClipboard, spawn, homedir, existsSync, mkdir, writeFile } =
  vi.hoisted(() => ({
    copyToClipboard: vi.fn(),
    spawn: vi.fn(),
    homedir: vi.fn(() => "/home/tester"),
    existsSync: vi.fn((target: unknown) =>
      String(target).endsWith("/git/HEAD"),
    ),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
  }));

vi.mock("node:child_process", () => ({ spawn }));
vi.mock("node:os", () => ({ homedir }));
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync,
    promises: {
      ...actual.promises,
      mkdir,
      writeFile,
    },
  };
});
vi.mock("@earendil-works/pi-coding-agent", async () => {
  const actual = await vi.importActual<
    typeof import("@earendil-works/pi-coding-agent")
  >("@earendil-works/pi-coding-agent");
  return { ...actual, copyToClipboard };
});

import timelineExtension from "./index.ts";

function mockGitCommand(
  match: string,
  result: { stdout?: string; stderr?: string; code?: number },
) {
  spawn.mockImplementationOnce((_command: string, args: string[]) => {
    expect(args.join(" ")).toContain(match);
    const handlers = new Map<string, (code?: number) => void>();
    return {
      stdout: {
        setEncoding: vi.fn(),
        on: vi.fn((event: string, cb: (chunk: string) => void) => {
          if (event === "data" && result.stdout) cb(result.stdout);
        }),
      },
      stderr: {
        setEncoding: vi.fn(),
        on: vi.fn((event: string, cb: (chunk: string) => void) => {
          if (event === "data" && result.stderr) cb(result.stderr);
        }),
      },
      on: vi.fn((event: string, cb: (code?: number) => void) => {
        handlers.set(event, cb);
        if (event === "close") cb(result.code ?? 0);
      }),
    };
  });
}

function setup(entries: unknown[] = []) {
  const commands = new Map<
    string,
    { handler: (...args: any[]) => Promise<void> | void }
  >();
  const handlers = new Map<string, (...args: any[]) => Promise<void> | void>();
  const pi = {
    registerCommand: vi.fn(
      (
        name: string,
        config: { handler: (...args: any[]) => Promise<void> | void },
      ) => commands.set(name, config),
    ),
    on: vi.fn(
      (name: string, handler: (...args: any[]) => Promise<void> | void) =>
        handlers.set(name, handler),
    ),
    appendEntry: vi.fn(),
  } as unknown as ExtensionAPI;
  const ctx = {
    cwd: "/repo",
    ui: { select: vi.fn(), notify: vi.fn() },
    navigateTree: vi.fn().mockResolvedValue({ cancelled: false }),
    sessionManager: {
      getEntries: vi.fn(() => entries),
      getLeafEntry: vi.fn(),
    },
  } as any;
  timelineExtension(pi);
  return { commands, handlers, ctx, pi };
}

describe("timeline extension", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers timeline command", () => {
    const { pi } = setup();
    expect(pi.registerCommand).toHaveBeenCalledWith(
      "timeline",
      expect.any(Object),
    );
  });

  it("copies selected user message", async () => {
    const { commands, ctx } = setup([
      {
        id: "u1",
        type: "message",
        timestamp: "2026-01-01T00:00:00.000Z",
        message: { role: "user", content: "hello" },
      },
    ]);
    ctx.ui.select.mockImplementationOnce(
      async (_title: string, options: string[]) => {
        expect(options[0]).toContain("hello");
        return options[0];
      },
    );
    ctx.ui.select.mockResolvedValueOnce("Copy");

    await commands.get("timeline")?.handler("", ctx);

    expect(copyToClipboard).toHaveBeenCalledWith("hello");
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Copied message to clipboard",
      "info",
    );
  });

  it("reverts before selected user message when snapshot exists", async () => {
    const entries = [
      {
        id: "u1",
        type: "message",
        timestamp: "2026-01-01T00:00:00.000Z",
        message: { role: "user", content: "hello" },
      },
      {
        type: "custom",
        customType: "timeline-snapshot",
        data: { entryId: "u1", snapshotRef: "abc123" },
      },
    ];
    const { commands, ctx } = setup(entries);
    ctx.ui.select.mockImplementationOnce(
      async (_title: string, options: string[]) => options[0],
    );
    ctx.ui.select.mockResolvedValueOnce("Revert");

    mockGitCommand("rev-parse --show-toplevel", { stdout: "/repo\n" });
    mockGitCommand("rev-parse --absolute-git-dir", { stdout: "/repo/.git\n" });
    mockGitCommand("rev-parse --git-path objects", {
      stdout: "/repo/.git/objects\n",
    });
    mockGitCommand("restore --source abc123 --staged --worktree .", {
      stdout: "",
    });
    mockGitCommand("clean -fd", { stdout: "" });

    await commands.get("timeline")?.handler("", ctx);

    expect(ctx.navigateTree).toHaveBeenCalledWith("u1", { summarize: false });
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Reverted before selected message",
      "info",
    );
  });

  it("reverts conversation even when snapshot is missing", async () => {
    const { commands, ctx } = setup([
      {
        id: "u1",
        type: "message",
        timestamp: "2026-01-01T00:00:00.000Z",
        message: { role: "user", content: "hello" },
      },
    ]);
    ctx.ui.select.mockImplementationOnce(
      async (_title: string, options: string[]) => options[0],
    );
    ctx.ui.select.mockResolvedValueOnce("Revert");

    mockGitCommand("rev-parse --show-toplevel", { code: 1, stderr: "fatal" });

    await commands.get("timeline")?.handler("", ctx);

    expect(ctx.navigateTree).toHaveBeenCalledWith("u1", { summarize: false });
  });

  it("captures the previous turn checkpoint on turn_end", async () => {
    const { handlers, ctx, pi } = setup([
      {
        id: "u1",
        type: "message",
        timestamp: "2026-01-01T00:00:00.000Z",
        message: { role: "user", content: "first" },
      },
    ]);
    mockGitCommand("rev-parse --show-toplevel", { stdout: "/repo\n" });
    mockGitCommand("rev-parse --absolute-git-dir", { stdout: "/repo/.git\n" });
    mockGitCommand("rev-parse --git-path objects", {
      stdout: "/repo/.git/objects\n",
    });
    mockGitCommand("add -A", { stdout: "" });
    mockGitCommand(
      "-c user.name=Pi Timeline -c user.email=pi-timeline@local commit --allow-empty -m timeline snapshot u1",
      { stdout: "" },
    );
    mockGitCommand("rev-parse HEAD", { stdout: "abc123\n" });
    mockGitCommand("update-ref refs/timeline/u1 abc123", { stdout: "" });

    await handlers.get("turn_end")?.({}, ctx);

    expect(pi.appendEntry).toHaveBeenCalledWith(
      "timeline-snapshot",
      expect.objectContaining({ entryId: "u1", snapshotRef: "abc123" }),
    );
  });

  it("surfaces checkpoint capture failures", async () => {
    const { handlers, ctx } = setup([
      {
        id: "u1",
        type: "message",
        timestamp: "2026-01-01T00:00:00.000Z",
        message: { role: "user", content: "first" },
      },
    ]);
    mockGitCommand("rev-parse --show-toplevel", { stdout: "/repo\n" });
    mockGitCommand("rev-parse --absolute-git-dir", { stdout: "/repo/.git\n" });
    mockGitCommand("rev-parse --git-path objects", {
      stdout: "/repo/.git/objects\n",
    });
    mockGitCommand("add -A", { code: 1, stderr: "boom" });

    await handlers.get("turn_end")?.({}, ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Timeline snapshot failed (turn): boom"),
      "warning",
    );
  });
});
