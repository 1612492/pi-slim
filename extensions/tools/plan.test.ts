import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createReadCurrentPlanTool,
  createWritePlanTool,
  formatPlanDocument,
  getNextPlanVersion,
  parsePlanVersionNumber,
  slugifyPlanTitle,
} from "./plan.js";

const originalCwd = process.cwd();
const originalHome = process.env.HOME;
const sessionFile =
  "/Users/tester/.pi/agent/sessions/--Users-tester-project--/session-123.jsonl";

describe("plan tools", () => {
  afterEach(async () => {
    process.chdir(originalCwd);
    process.env.HOME = originalHome;
  });

  it("formats plan documents with metadata", () => {
    const text = formatPlanDocument({
      title: "Refactor cache",
      body: "## Goal\n\nReduce duplication.",
      version: 2,
      sessionFile,
      finalizedAt: new Date("2026-05-01T00:00:00.000Z"),
    });

    expect(text).toContain("# Finalized Plan");
    expect(text).toContain("- Title: Refactor cache");
    expect(text).toContain("- Version: 2");
    expect(text).toContain("2026-05-01T00:00:00.000Z");
  });

  it("parses plan version file names", () => {
    expect(parsePlanVersionNumber("plan-v12.md")).toBe(12);
    expect(parsePlanVersionNumber("docs-lookup-refactor-v3.md")).toBe(3);
    expect(parsePlanVersionNumber("current-plan.md")).toBeUndefined();
  });

  it("slugifies plan titles", () => {
    expect(slugifyPlanTitle("Refactor docs lookup flow")).toBe(
      "refactor-docs-lookup-flow",
    );
  });

  it("computes next plan version from existing snapshots", async () => {
    expect(
      await getNextPlanVersion(
        async () => ["plan-v1.md", "plan-v3.md"],
        "/tmp/x",
      ),
    ).toBe(4);
  });

  it("write_plan creates current and versioned plan files", async () => {
    const testDir = await mkdtemp(join(tmpdir(), "pi-plan-test-"));
    process.chdir(testDir);
    process.env.HOME = testDir;

    const tool = createWritePlanTool(() => sessionFile);
    const result = await tool.execute(
      "1",
      {
        title: "Planner-led routing",
        body: "## Goal\n\nAvoid duplicate retrieval.",
      },
      undefined,
      undefined,
      {} as never,
    );

    const currentPlanPath = `${testDir}/.cache/pi/plans/--Users-tester-project--/session-123/current-plan.md`;
    const versionPlanPath = `${testDir}/.cache/pi/plans/--Users-tester-project--/session-123/planner-led-routing-v1.md`;

    await expect(access(currentPlanPath)).resolves.toBeUndefined();
    await expect(access(versionPlanPath)).resolves.toBeUndefined();
    await expect(readFile(currentPlanPath, "utf8")).resolves.toContain(
      "Planner-led routing",
    );
    expect(result.details).toEqual(
      expect.objectContaining({
        version: 1,
        currentPlanPath,
        versionPlanPath,
      }),
    );
  });

  it("read_current_plan reads the latest canonical session plan", async () => {
    const testDir = await mkdtemp(join(tmpdir(), "pi-plan-test-"));
    process.chdir(testDir);
    process.env.HOME = testDir;

    const writeTool = createWritePlanTool(() => sessionFile);
    await writeTool.execute(
      "1",
      {
        title: "First",
        body: "Body one",
      },
      undefined,
      undefined,
      {} as never,
    );
    await writeTool.execute(
      "2",
      {
        title: "Second",
        body: "Body two",
      },
      undefined,
      undefined,
      {} as never,
    );

    const readTool = createReadCurrentPlanTool(() => sessionFile);
    const result = await readTool.execute(
      "3",
      { includeVersionHistory: true },
      undefined,
      undefined,
      {} as never,
    );

    expect((result.content[0] as { text: string }).text).toContain("Body two");
    expect((result.content[0] as { text: string }).text).toContain(
      "first-v1.md",
    );
    expect((result.content[0] as { text: string }).text).toContain(
      "second-v2.md",
    );
    expect(result.details).toEqual(
      expect.objectContaining({
        version: 2,
        currentPlanPath: expect.stringContaining("current-plan.md"),
      }),
    );
  });
});
