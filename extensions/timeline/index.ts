import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  copyToClipboard,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const SNAPSHOT_ENTRY_TYPE = "timeline-snapshot";
const RESUME_ENTRY_TYPE = "timeline-resume";
const SNAPSHOT_ROOT = path.join(os.homedir(), ".pi", "agent", "snapshot");

type TextPart = { type?: string; text?: string };

type SessionMessageEntry = {
  id: string;
  type: "message";
  timestamp?: string;
  message: {
    role: string;
    content: string | TextPart[];
  };
};

type SessionCustomEntry = {
  type: "custom";
  customType?: string;
  data?: {
    entryId?: string;
    snapshotRef?: string;
    kind?: "resume" | "turn";
  };
};

type SessionEntry = SessionMessageEntry | SessionCustomEntry;

type GitRepoInfo = {
  root: string;
  gitDir: string;
  objectsDir: string;
};

type TimelineCommandContext = ExtensionContext & {
  navigateTree(
    targetId: string,
    options?: { summarize?: boolean },
  ): Promise<{ cancelled: boolean }>;
};

function getEntryText(content: string | TextPart[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("");
}

function buildPreview(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim() || "(empty message)";
  return compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
}

function buildTimelineLabel(entry: SessionMessageEntry): string {
  const prefix = entry.timestamp
    ? new Date(entry.timestamp).toLocaleString()
    : entry.id.slice(0, 8);
  return `${prefix} — ${buildPreview(getEntryText(entry.message.content))}`;
}

function snapshotRepoDir(repoRoot: string): string {
  const repoHash = createHash("sha1").update(repoRoot).digest("hex");
  return path.join(SNAPSHOT_ROOT, repoHash, "git");
}

function runGit(
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

async function resolveGitRepo(cwd: string): Promise<GitRepoInfo | undefined> {
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

async function ensureSnapshotRepo(repo: GitRepoInfo): Promise<string> {
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

async function captureSnapshot(
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

async function captureSnapshotForEntry(
  ctx: ExtensionContext,
  appendEntry: (type: string, data: Record<string, unknown>) => void,
  repo: GitRepoInfo,
  entryId: string,
  kind: "resume" | "turn",
): Promise<string | undefined> {
  const snapshotRef = await captureSnapshot(repo, entryId).catch((error) => {
    ctx.ui.notify(
      `Timeline snapshot failed (${kind}): ${error instanceof Error ? error.message : String(error)}`,
      "warning",
    );
    return undefined;
  });
  if (snapshotRef) {
    appendEntry(kind === "resume" ? RESUME_ENTRY_TYPE : SNAPSHOT_ENTRY_TYPE, {
      entryId,
      snapshotRef,
      kind,
    });
  }
  return snapshotRef;
}

async function restoreSnapshot(
  repo: GitRepoInfo,
  snapshotRef: string,
): Promise<void> {
  const gitDir = await ensureSnapshotRepo(repo);
  await runGit(
    ["restore", "--source", snapshotRef, "--staged", "--worktree", "."],
    {
      gitDir,
      workTree: repo.root,
    },
  );
  await runGit(["clean", "-fd"], {
    gitDir,
    workTree: repo.root,
    allowFailure: true,
  });
}

function loadSnapshots(entries: SessionEntry[]): Map<string, string> {
  const snapshots = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type !== "custom") continue;
    if (entry.customType !== SNAPSHOT_ENTRY_TYPE) continue;
    const entryId = entry.data?.entryId;
    const snapshotRef = entry.data?.snapshotRef;
    if (entryId && snapshotRef) snapshots.set(entryId, snapshotRef);
  }
  return snapshots;
}

export default function timelineExtension(pi: ExtensionAPI): void {
  let snapshots = new Map<string, string>();

  pi.on("session_start", async (_event, ctx) => {
    snapshots = loadSnapshots(
      ctx.sessionManager.getEntries() as SessionEntry[],
    );
    const appendEntry = (
      pi as {
        appendEntry: (type: string, data: Record<string, unknown>) => void;
      }
    ).appendEntry;
    const repo = await resolveGitRepo(ctx.cwd);
    const leaf = ctx.sessionManager.getLeafEntry?.() as
      | SessionEntry
      | undefined;
    if (repo && leaf?.type === "message") {
      await captureSnapshotForEntry(ctx, appendEntry, repo, leaf.id, "resume");
    }
  });

  pi.on("turn_end", async (_event, ctx) => {
    const repo = await resolveGitRepo(ctx.cwd);
    if (!repo) return;

    const entries = ctx.sessionManager.getEntries() as SessionEntry[];
    const lastUser = [...entries]
      .reverse()
      .find(
        (entry): entry is SessionMessageEntry =>
          entry.type === "message" && entry.message.role === "user",
      );
    if (!lastUser || snapshots.has(lastUser.id)) return;
    const appendEntry = (
      pi as {
        appendEntry: (type: string, data: Record<string, unknown>) => void;
      }
    ).appendEntry;
    const snapshotRef = await captureSnapshotForEntry(
      ctx,
      appendEntry,
      repo,
      lastUser.id,
      "turn",
    );
    if (snapshotRef) snapshots.set(lastUser.id, snapshotRef);
  });

  pi.registerCommand("timeline", {
    description:
      "Browse user message history and copy or revert before a message",
    handler: async (_args: string, rawCtx: ExtensionContext) => {
      const ctx = rawCtx as TimelineCommandContext;
      const entries = ctx.sessionManager.getEntries() as SessionEntry[];
      snapshots = loadSnapshots(entries);

      const userEntries = entries.filter(
        (entry): entry is SessionMessageEntry =>
          entry.type === "message" && entry.message.role === "user",
      );

      if (userEntries.length === 0) {
        ctx.ui.notify("No user messages in this session", "info");
        return;
      }

      const messageLabels = userEntries.map(buildTimelineLabel).reverse();
      const selectedLabel = await ctx.ui.select("Timeline", messageLabels);
      if (!selectedLabel) return;

      const selectedIndex = messageLabels.indexOf(selectedLabel);
      const selectedEntry = userEntries[userEntries.length - 1 - selectedIndex];
      if (!selectedEntry) return;

      const repo = await resolveGitRepo(ctx.cwd);
      const snapshotRef = snapshots.get(selectedEntry.id);
      const actionOptions = ["Revert", "Copy"];

      const action = await ctx.ui.select(
        buildPreview(getEntryText(selectedEntry.message.content)),
        actionOptions,
      );
      if (!action) return;

      if (action === "Copy") {
        await copyToClipboard(getEntryText(selectedEntry.message.content));
        ctx.ui.notify("Copied message to clipboard", "info");
        return;
      }

      if (repo && snapshotRef) {
        await restoreSnapshot(repo, snapshotRef).catch((error) => {
          if (ctx.hasUI) {
            ctx.ui.notify(
              `Timeline file restore skipped: ${error instanceof Error ? error.message : String(error)}`,
              "warning",
            );
          }
        });
      }
      const result = await ctx.navigateTree(selectedEntry.id, {
        summarize: false,
      });
      if (result.cancelled) {
        ctx.ui.notify("Revert cancelled", "info");
        return;
      }
      ctx.ui.notify("Reverted before selected message", "info");
    },
  });
}
