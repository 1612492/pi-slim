import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  keyHint,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

export function buildToolText(details: Record<string, unknown>, text: string) {
  const truncation = truncateHead(text, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  if (!truncation.truncated) {
    return {
      text: truncation.content,
      details: { ...details, truncation },
    };
  }

  const truncatedLines = truncation.totalLines - truncation.outputLines;
  const truncatedBytes = truncation.totalBytes - truncation.outputBytes;
  return {
    text: `${truncation.content}\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ${truncatedLines} lines (${formatSize(truncatedBytes)}) omitted.]`,
    details: { ...details, truncation },
  };
}

export function renderCollapsedTextResult(input: {
  result: {
    content: Array<{ type: string; text?: string }>;
    details?: Record<string, unknown>;
  };
  expanded: boolean;
  isPartial: boolean;
  theme: { fg(color: string, text: string): string };
  partialLabel: string;
  summaryLabel: string;
}) {
  const { result, expanded, isPartial, theme, partialLabel, summaryLabel } =
    input;

  if (isPartial) {
    return new Text(theme.fg("warning", partialLabel), 0, 0);
  }

  const output =
    result.content[0]?.type === "text" ? result.content[0].text : "";
  if (expanded) return new Text(output, 0, 0);

  const summary =
    theme.fg("success", "✓ ") +
    theme.fg("muted", summaryLabel) +
    "\n" +
    theme.fg("dim", keyHint("app.tools.expand", "to expand"));
  return new Text(summary, 0, 0);
}
