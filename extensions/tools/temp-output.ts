import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";

const tempDirs = new Set<string>();

export async function writeTempOutputFile(text: string) {
  const tempDir = await mkdtemp(join(tmpdir(), "pi-tool-"));
  const tempFile = join(tempDir, "output.txt");

  tempDirs.add(tempDir);
  await withFileMutationQueue(tempFile, async () => {
    await writeFile(tempFile, text, "utf8");
  });

  return { tempDir, tempFile };
}

export async function cleanupTempOutputFiles() {
  const dirs = Array.from(tempDirs);
  tempDirs.clear();

  await Promise.all(
    dirs.map(async (dir) => {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup failures
      }
    }),
  );
}

export function getTrackedTempDirs() {
  return Array.from(tempDirs);
}
