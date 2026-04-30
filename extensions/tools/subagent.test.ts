import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSpawnPiSubagentTool,
  formatSubagentListOutput,
} from "./subagent.js";

describe("spawn_pi_subagent tool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formats available subagents", () => {
    expect(
      formatSubagentListOutput([
        {
          name: "explorer",
          description: "Local recon",
          tools: ["read", "grep"],
        },
      ]),
    ).toContain("- explorer: Local recon");
  });

  it("lists built-in subagents", async () => {
    const tool = createSpawnPiSubagentTool(() => "demo");
    const result = await tool.execute(
      "1",
      { action: "list" },
      undefined,
      undefined,
      {} as never,
    );

    expect(result.content[0]).toEqual(
      expect.objectContaining({ type: "text" }),
    );
    expect((result.content[0] as { text: string }).text).toContain("explorer");
    expect((result.content[0] as { text: string }).text).toContain("librarian");
  });

  it("runs a child pi role and writes cached output", async () => {
    const runner = vi.fn().mockResolvedValue({
      command: "pi",
      args: ["--mode", "json", "task"],
      stdout:
        '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}\n',
      stderr: "",
      exitCode: 0,
      finalText: "done",
    });

    const tool = createSpawnPiSubagentTool(() => "demo", { runner });
    const result = await tool.execute(
      "1",
      { role: "explorer", task: "Trace the cache path flow" },
      undefined,
      undefined,
      {} as never,
    );

    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({ task: "Trace the cache path flow" }),
    );
    expect(result.content[0]).toEqual(
      expect.objectContaining({ type: "text" }),
    );
    expect((result.content[0] as { text: string }).text).toContain(
      "Role: explorer",
    );
    expect((result.content[0] as { text: string }).text).toContain("done");
    expect(result.details).toEqual(
      expect.objectContaining({
        role: "explorer",
        fullEventStreamPath: expect.stringContaining(".cache/pi/subagents/"),
        fullOutputPath: expect.stringContaining(".cache/pi/subagents/"),
      }),
    );
  });
});
