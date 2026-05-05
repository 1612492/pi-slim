import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverAgents } from "./agents.js";

const originalHome = process.env.HOME;

describe("subagent agent discovery", () => {
  afterEach(() => {
    process.env.HOME = originalHome;
  });

  it("loads project agents and lets them override user agents", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-agents-test-"));
    const userAgentsDir = join(root, "home", ".pi", "agent", "agents");
    const projectAgentsDir = join(root, "repo", "agents");
    await mkdir(userAgentsDir, { recursive: true });
    await mkdir(projectAgentsDir, { recursive: true });
    process.env.HOME = join(root, "home");

    await writeFile(
      join(userAgentsDir, "explorer.md"),
      `---\nname: explorer\ndescription: user explorer\ntools: read\n---\nUser prompt`,
    );
    await writeFile(
      join(projectAgentsDir, "explorer.md"),
      `---\nname: explorer\ndescription: project explorer\ntools: read, grep\n---\nProject prompt`,
    );
    await writeFile(
      join(projectAgentsDir, "oracle.md"),
      `---\nname: oracle\ndescription: project oracle\n---\nOracle prompt`,
    );

    const both = discoverAgents(join(root, "repo"), "both");
    expect(both.projectAgentsDir).toBe(projectAgentsDir);
    expect(
      both.agents.find((agent) => agent.name === "explorer")?.description,
    ).toBe("project explorer");
    expect(both.agents.map((agent) => agent.name).sort()).toEqual([
      "explorer",
      "oracle",
    ]);
  });
});
