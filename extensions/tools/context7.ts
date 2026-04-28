import {
  defineTool,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  keyHint,
  truncateHead,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";
import { writeTempOutputFile } from "./temp-output.js";

const CONTEXT7_BASE_URL = "https://context7.com/api/v2";

export const context7Params = Type.Object({
  library: Type.Optional(
    Type.String({
      description: "Library name to resolve, like react or next.js",
    }),
  ),
  libraryId: Type.Optional(
    Type.String({
      description: "Explicit Context7 library id like /vercel/next.js",
    }),
  ),
  query: Type.String({ description: "Documentation question to answer" }),
});

export type Context7Params = {
  library?: string;
  libraryId?: string;
  query: string;
};

export interface Context7LibraryResult {
  id: string;
  title?: string;
  description?: string;
  branch?: string;
  state?: string;
}

export interface Context7LibrarySearchResponse {
  results?: Context7LibraryResult[];
  searchFilterApplied?: boolean;
}

export interface Context7ToolDetails extends Record<string, unknown> {
  libraryId?: string;
  libraryTitle?: string;
  libraryDescription?: string;
  truncation?: {
    truncated?: boolean;
  };
  fullOutputPath?: string;
}

export function getContext7ApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const key = env.CONTEXT7_API_KEY?.trim();
  if (!key) throw new Error("CONTEXT7_API_KEY is not configured");
  return key;
}

export function buildContext7Headers(apiKey: string) {
  return {
    authorization: `Bearer ${apiKey}`,
  };
}

export function buildContext7SearchUrl(params: {
  library: string;
  query: string;
}) {
  const url = new URL(`${CONTEXT7_BASE_URL}/libs/search`);
  url.searchParams.set("libraryName", params.library);
  url.searchParams.set("query", params.query);
  return url.toString();
}

export function buildContext7DocsUrl(params: {
  libraryId: string;
  query: string;
}) {
  const url = new URL(`${CONTEXT7_BASE_URL}/context`);
  url.searchParams.set("libraryId", params.libraryId);
  url.searchParams.set("query", params.query);
  url.searchParams.set("type", "txt");
  return url.toString();
}

export async function resolveContext7Library(
  fetchImpl: typeof fetch,
  apiKey: string,
  params: { library: string; query: string },
  signal?: AbortSignal,
) {
  const response = await fetchImpl(buildContext7SearchUrl(params), {
    headers: buildContext7Headers(apiKey),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Context7 library resolve failed (${response.status} ${response.statusText}): ${errorText || "No response body"}`,
    );
  }

  const data = (await response.json()) as Context7LibrarySearchResponse;
  const bestMatch = data.results?.[0];
  if (!bestMatch)
    throw new Error(`No Context7 library found for \"${params.library}\"`);

  return bestMatch;
}

export async function queryContext7Docs(
  fetchImpl: typeof fetch,
  apiKey: string,
  params: { libraryId: string; query: string },
  signal?: AbortSignal,
) {
  const response = await fetchImpl(buildContext7DocsUrl(params), {
    headers: buildContext7Headers(apiKey),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Context7 docs query failed (${response.status} ${response.statusText}): ${errorText || "No response body"}`,
    );
  }

  return await response.text();
}

export function normalizeContext7DocsText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function formatContext7Output(result: {
  libraryId: string;
  libraryTitle?: string;
  libraryDescription?: string;
  docsText: string;
}) {
  const lines: string[] = [];
  if (result.libraryTitle) lines.push(`Library: ${result.libraryTitle}`);
  lines.push(`Library ID: ${result.libraryId}`);
  if (result.libraryDescription)
    lines.push(`Description: ${result.libraryDescription}`);
  lines.push("", normalizeContext7DocsText(result.docsText));
  return lines.join("\n").trim();
}

export function getContext7CollapsedLabel(input: {
  libraryTitle?: string;
  libraryId?: string;
  query?: string;
  truncated?: boolean;
}) {
  const target = input.libraryTitle?.trim() || input.libraryId?.trim() || "library docs";
  const parts = [`Docs for ${target}`];
  if (input.query?.trim()) parts.push(`for \"${input.query.trim()}\"`);
  if (input.truncated) parts.push("[truncated]");
  return parts.join(" ");
}

export async function buildTruncatedContextText(
  details: Record<string, unknown>,
  text: string,
) {
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

  const { tempFile } = await writeTempOutputFile(text);

  const truncatedLines = truncation.totalLines - truncation.outputLines;
  const truncatedBytes = truncation.totalBytes - truncation.outputBytes;
  const message = `${truncation.content}\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ${truncatedLines} lines (${formatSize(truncatedBytes)}) omitted. Full output saved to: ${tempFile}]`;

  return {
    text: message,
    details: { ...details, truncation, fullOutputPath: tempFile },
  };
}

export const context7Tool = defineTool({
  name: "context7",
  label: "Context7",
  description: `Query Context7 for up-to-date library documentation and examples. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}. Requires CONTEXT7_API_KEY.`,
  promptSnippet:
    "Look up current library and framework documentation with Context7",
  promptGuidelines: [
    "Use context7 for framework, library, and SDK documentation instead of general web search.",
    "Use context7 when version-aware API docs or code examples matter.",
  ],
  parameters: context7Params,
  async execute(_toolCallId, params, signal) {
    const apiKey = getContext7ApiKey();
    const explicitLibraryId = params.libraryId?.trim();
    const library = params.library?.trim();

    if (!explicitLibraryId && !library) {
      throw new Error(
        "Either libraryId or library must be provided for context7",
      );
    }

    const resolved = explicitLibraryId
      ? { id: explicitLibraryId, title: undefined, description: undefined }
      : await resolveContext7Library(
          fetch,
          apiKey,
          { library: library!, query: params.query },
          signal,
        );

    if (!resolved.id) {
      throw new Error(
        "Either libraryId or library must be provided for context7",
      );
    }

    const docsText = await queryContext7Docs(
      fetch,
      apiKey,
      { libraryId: resolved.id, query: params.query },
      signal,
    );
    const formatted = formatContext7Output({
      libraryId: resolved.id,
      libraryTitle: resolved.title,
      libraryDescription: resolved.description,
      docsText,
    });
    const result = await buildTruncatedContextText(
      {
        libraryId: resolved.id,
        libraryTitle: resolved.title,
        libraryDescription: resolved.description,
      },
      formatted,
    );

    return {
      content: [{ type: "text", text: result.text }],
      details: result.details,
    };
  },
  renderResult(result, { expanded, isPartial }, theme, context) {
    if (isPartial) {
      return new Text(theme.fg("warning", "Looking up docs..."), 0, 0);
    }

    const text = result.content[0];
    const output = text?.type === "text" ? text.text : "";
    const details = (result.details ?? {}) as Context7ToolDetails;

    if (expanded) {
      return new Text(output, 0, 0);
    }

    const query =
      typeof context.args === "object" && context.args && "query" in context.args
        ? String((context.args as { query?: string }).query ?? "")
        : "";
    let summary =
      theme.fg("success", "✓ ") +
      theme.fg(
        "muted",
        getContext7CollapsedLabel({
          libraryTitle: details.libraryTitle,
          libraryId: details.libraryId,
          query,
          truncated: !!details.truncation?.truncated,
        }),
      );

    if (details.libraryId) {
      summary += "\n" + theme.fg("dim", `Library ID: ${details.libraryId}`);
    }

    summary += "\n" + theme.fg("dim", keyHint("app.tools.expand", "to expand"));

    return new Text(summary, 0, 0);
  },
});
