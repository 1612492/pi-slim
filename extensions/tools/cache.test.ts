import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCachedToolText, createCacheWriter } from "./cache.js";

const originalCwd = process.cwd();
const originalHome = process.env.HOME;
const sessionFile =
  "/Users/phat/.pi/agent/sessions/--Users-phat-git-1612492-pi-slim--/2026-04-30T15-42-32-577Z_019ddf0e-5880-712e-b71a-c679c02f2e81.jsonl";

describe("cache writer", () => {
  let testDir: string;

  afterEach(async () => {
    process.chdir(originalCwd);
    process.env.HOME = originalHome;
  });

  it("writes into the session-scoped tools cache under $HOME/.cache/pi", async () => {
    testDir = await mkdtemp(join(tmpdir(), "pi-cache-test-"));
    process.chdir(testDir);
    process.env.HOME = testDir;
    const writer = createCacheWriter(() => sessionFile);

    const { cacheFile, sessionCacheDir } =
      await writer.writeToolOutputFile("hello");

    expect(sessionCacheDir).toBe(
      `${testDir}/.cache/pi/--Users-phat-git-1612492-pi-slim--/2026-04-30T15-42-32-577Z_019ddf0e-5880-712e-b71a-c679c02f2e81`,
    );
    expect(cacheFile).toContain(
      ".cache/pi/tools/--Users-phat-git-1612492-pi-slim--/2026-04-30T15-42-32-577Z_019ddf0e-5880-712e-b71a-c679c02f2e81/",
    );
    await expect(access(cacheFile)).resolves.toBeUndefined();
    await expect(readFile(cacheFile, "utf8")).resolves.toBe("hello");
  });

  it("falls back to the default session folder", async () => {
    testDir = await mkdtemp(join(tmpdir(), "pi-cache-test-"));
    process.chdir(testDir);
    process.env.HOME = testDir;
    const writer = createCacheWriter(() => undefined);

    const { cacheFile } = await writer.writeCacheFile("plan", {
      category: "plans",
    });

    expect(cacheFile).toContain(".cache/pi/plans/default/default/");
  });

  it("supports a custom relative path under the category folder", async () => {
    testDir = await mkdtemp(join(tmpdir(), "pi-cache-test-"));
    process.chdir(testDir);
    process.env.HOME = testDir;
    const writer = createCacheWriter(() => sessionFile);

    const { cacheFile } = await writer.writeCacheFile("x", {
      category: "plans",
      path: "drafts/step-1.md",
    });

    expect(cacheFile).toContain(
      ".cache/pi/plans/--Users-phat-git-1612492-pi-slim--/2026-04-30T15-42-32-577Z_019ddf0e-5880-712e-b71a-c679c02f2e81/drafts/step-1.md",
    );
  });

  it("always saves tool output and returns the cache file path", async () => {
    testDir = await mkdtemp(join(tmpdir(), "pi-cache-test-"));
    process.chdir(testDir);
    process.env.HOME = testDir;
    const writer = createCacheWriter(() => sessionFile);

    const result = await buildCachedToolText(writer, {}, "short output", {
      category: "tools",
      prefix: "web_search_exa",
    });

    expect(result.text).toContain("short output");
    expect(result.text).toContain("Full output saved to:");
    expect(String(result.details.fullOutputPath)).toContain(
      ".cache/pi/tools/--Users-phat-git-1612492-pi-slim--/2026-04-30T15-42-32-577Z_019ddf0e-5880-712e-b71a-c679c02f2e81/web_search_exa-",
    );
    await expect(
      readFile(String(result.details.fullOutputPath), "utf8"),
    ).resolves.toBe("short output");
  });

  it("clears tools cache without removing plans cache", async () => {
    testDir = await mkdtemp(join(tmpdir(), "pi-cache-test-"));
    process.chdir(testDir);
    process.env.HOME = testDir;
    const writer = createCacheWriter(() => sessionFile);

    const { cacheFile: toolFile } = await writer.writeCacheFile("tool", {
      category: "tools",
    });
    const { cacheFile: planFile } = await writer.writeCacheFile("plan", {
      category: "plans",
    });

    await writer.clearCacheCategory("tools");

    await expect(access(toolFile)).rejects.toThrow();
    await expect(readFile(planFile, "utf8")).resolves.toBe("plan");
  });

  it("removes empty session cache folders when tools are the only category", async () => {
    testDir = await mkdtemp(join(tmpdir(), "pi-cache-test-"));
    process.chdir(testDir);
    process.env.HOME = testDir;
    const writer = createCacheWriter(() => sessionFile);

    const { cacheFile } = await writer.writeCacheFile("tool", {
      category: "tools",
    });
    const sessionCacheDir = writer.getSessionCacheDir();

    await writer.clearCacheCategory("tools");

    await expect(access(cacheFile)).rejects.toThrow();
    await expect(access(sessionCacheDir)).rejects.toThrow();
  });
});
