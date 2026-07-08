import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverAgents } from "./utils.ts";

const originalHome = process.env.HOME;

describe("subagent agent discovery", () => {
  afterEach(() => {
    process.env.HOME = originalHome;
  });

  it("loads built-in agents globally and lets user agents override them", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-agents-test-"));
    const userAgentsDir = join(root, "home", ".pi", "agent", "agents");
    await mkdir(userAgentsDir, { recursive: true });
    process.env.HOME = join(root, "home");

    await writeFile(
      join(userAgentsDir, "explorer.md"),
      `---\nname: explorer\ndescription: user explorer\ntools: read\n---\nUser prompt`,
    );

    const both = discoverAgents("both");
    expect(both.builtInAgentsDir).toBe(join(process.cwd(), "agents"));
    expect(
      both.agents.find((agent) => agent.name === "explorer")?.description,
    ).toBe("user explorer");
    expect(both.agents.map((agent) => agent.name).sort()).toEqual([
      "explorer",
      "fixer",
      "librarian",
      "oracle",
    ]);
  });

  it("defaults to builtin-only discovery", async () => {
    const result = discoverAgents("builtin");
    expect(result.agents.map((agent) => agent.source)).toEqual([
      "builtin",
      "builtin",
      "builtin",
      "builtin",
    ]);
  });
});
