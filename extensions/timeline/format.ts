import type { SessionMessageEntry, TextPart } from "./types.ts";

export function getEntryText(content: string | TextPart[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("");
}

export function buildPreview(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim() || "(empty message)";
  return compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
}

export function buildTimelineLabel(entry: SessionMessageEntry): string {
  const prefix = entry.timestamp
    ? new Date(entry.timestamp).toLocaleString()
    : entry.id.slice(0, 8);
  return `${prefix} — ${buildPreview(getEntryText(entry.message.content))}`;
}
