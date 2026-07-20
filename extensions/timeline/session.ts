import type { SessionEntry } from "./types.ts";
import { SNAPSHOT_ENTRY_TYPE } from "./types.ts";

export function loadSnapshots(entries: SessionEntry[]): Map<string, string> {
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
