import {
  copyToClipboard,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { buildPreview, buildTimelineLabel, getEntryText } from "./format.ts";
import { captureSnapshot, restoreSnapshot, resolveGitRepo } from "./git.ts";
import { loadSnapshots } from "./session.ts";
import {
  RESUME_ENTRY_TYPE,
  SNAPSHOT_ENTRY_TYPE,
  type SessionEntry,
  type SessionMessageEntry,
} from "./types.ts";

type TimelineCommandContext = ExtensionContext & {
  navigateTree(
    targetId: string,
    options?: { summarize?: boolean },
  ): Promise<{ cancelled: boolean }>;
};

type TimelineAPI = Pick<ExtensionAPI, "on" | "registerCommand"> & {
  appendEntry(type: string, data: Record<string, unknown>): void;
};

export function registerTimelineCommand(pi: TimelineAPI): void {
  let snapshots = new Map<string, string>();
  pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
    snapshots = loadSnapshots(
      ctx.sessionManager.getEntries() as SessionEntry[],
    );
    const appendEntry = pi.appendEntry;
    const repo = await resolveGitRepo(ctx.cwd);
    const leaf = ctx.sessionManager.getLeafEntry?.() as
      | SessionEntry
      | undefined;
    if (repo && leaf?.type === "message") {
      await captureSnapshotForEntry(ctx, appendEntry, repo, leaf.id, "resume");
    }
  });
  pi.on("turn_end", async (_event: unknown, ctx: ExtensionContext) => {
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
    const appendEntry = pi.appendEntry;
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
      const action = await ctx.ui.select(
        buildPreview(getEntryText(selectedEntry.message.content)),
        ["Revert", "Copy"],
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

async function captureSnapshotForEntry(
  ctx: ExtensionContext,
  appendEntry: (type: string, data: Record<string, unknown>) => void,
  repo: NonNullable<Awaited<ReturnType<typeof resolveGitRepo>>>,
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
  if (snapshotRef)
    appendEntry(kind === "resume" ? RESUME_ENTRY_TYPE : SNAPSHOT_ENTRY_TYPE, {
      entryId,
      snapshotRef,
      kind,
    });
  return snapshotRef;
}
