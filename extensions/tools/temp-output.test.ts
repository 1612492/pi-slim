import { access } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupTempOutputFiles,
  getTrackedTempDirs,
  writeTempOutputFile,
} from "./temp-output.js";

describe("temp output cleanup", () => {
  afterEach(async () => {
    await cleanupTempOutputFiles();
  });

  it("tracks and cleans temp output dirs", async () => {
    const { tempDir, tempFile } = await writeTempOutputFile("hello");

    expect(getTrackedTempDirs()).toContain(tempDir);
    await expect(access(tempFile)).resolves.toBeUndefined();

    await cleanupTempOutputFiles();

    expect(getTrackedTempDirs()).toEqual([]);
    await expect(access(tempFile)).rejects.toThrow();
  });
});
