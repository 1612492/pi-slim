import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { GitRepoInfo } from "./types.ts";

const SNAPSHOT_ROOT = path.join(os.homedir(), ".pi", "agent", "snapshot");

function snapshotRepoDir(repoRoot: string): string {
  const repoHash = createHash("sha1").update(repoRoot).digest("hex");
  return path.join(SNAPSHOT_ROOT, repoHash, "git");
}

export function runGit(
  args: string[],
  options: {
    cwd?: string;
    gitDir?: string;
    workTree?: string;
    allowFailure?: boolean;
  } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const commandArgs = [...args];
    if (options.gitDir)
      (commandArgs.unshift(options.gitDir), commandArgs.unshift("--git-dir"));
    if (options.workTree)
      (commandArgs.unshift(options.workTree),
        commandArgs.unshift("--work-tree"));
    const child = spawn("git", commandArgs, {
      cwd: options.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if ((code ?? 1) !== 0 && !options.allowFailure) {
        reject(new Error(stderr.trim() || `git ${args.join(" ")} failed`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function runGitInit(targetDir: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("git", ["init", "--bare", targetDir], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if ((code ?? 1) !== 0) {
        reject(new Error(stderr.trim() || `git init ${targetDir} failed`));
        return;
      }
      resolve();
    });
  });
}

export async function resolveGitRepo(
  cwd: string,
): Promise<GitRepoInfo | undefined> {
  try {
    const root = (
      await runGit(["rev-parse", "--show-toplevel"], { cwd })
    ).stdout.trim();
    const gitDir = (
      await runGit(["rev-parse", "--absolute-git-dir"], { cwd })
    ).stdout.trim();
    const objectsDir = (
      await runGit(["rev-parse", "--git-path", "objects"], { cwd })
    ).stdout.trim();
    if (!root || !gitDir || !objectsDir) return undefined;
    return { root, gitDir, objectsDir };
  } catch {
    return undefined;
  }
}

export async function ensureSnapshotRepo(repo: GitRepoInfo): Promise<string> {
  const gitDir = snapshotRepoDir(repo.root);
  await fs.promises.mkdir(gitDir, { recursive: true });
  if (!fs.existsSync(path.join(gitDir, "HEAD"))) {
    await runGitInit(gitDir);
    await runGit(["config", "core.worktree", repo.root], { gitDir });
  }
  const alternatesDir = path.join(gitDir, "objects", "info");
  await fs.promises.mkdir(alternatesDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(alternatesDir, "alternates"),
    `${repo.objectsDir}\n`,
    "utf8",
  );
  return gitDir;
}

export async function captureSnapshot(
  repo: GitRepoInfo,
  entryId: string,
): Promise<string | undefined> {
  const gitDir = await ensureSnapshotRepo(repo);
  await runGit(["add", "-A"], { gitDir, workTree: repo.root });
  await runGit(
    [
      "-c",
      "user.name=Pi Timeline",
      "-c",
      "user.email=pi-timeline@local",
      "commit",
      "--allow-empty",
      "-m",
      `timeline snapshot ${entryId}`,
    ],
    { gitDir, workTree: repo.root },
  );
  const refName = `refs/timeline/${entryId}`;
  const snapshotRef = (
    await runGit(["rev-parse", "HEAD"], { gitDir, workTree: repo.root })
  ).stdout.trim();
  if (!snapshotRef) return undefined;
  await runGit(["update-ref", refName, snapshotRef], {
    gitDir,
    workTree: repo.root,
  });
  return snapshotRef;
}

export async function restoreSnapshot(
  repo: GitRepoInfo,
  snapshotRef: string,
): Promise<void> {
  const gitDir = await ensureSnapshotRepo(repo);
  await runGit(
    ["restore", "--source", snapshotRef, "--staged", "--worktree", "."],
    { gitDir, workTree: repo.root },
  );
  await runGit(["clean", "-fd"], {
    gitDir,
    workTree: repo.root,
    allowFailure: true,
  });
}
