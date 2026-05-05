import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  defineTool,
  formatSize,
  keyHint,
  truncateHead,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const EXA_CONTENTS_URL = "https://api.exa.ai/contents";
const DEFAULT_NUM_RESULTS = 5;
const MAX_NUM_RESULTS = 10;
const DEFAULT_HIGHLIGHT_CHARACTERS = 600;
const MAX_SNIPPET_LENGTH = 240;

export const webSearchExaParams = Type.Object({
  query: Type.String({ description: "Natural-language web search query" }),
  numResults: Type.Optional(
    Type.Number({ description: "Max results to return (1-10)" }),
  ),
});

export const webFetchExaParams = Type.Object({
  url: Type.String({ description: "The URL to fetch and extract" }),
});

export type WebSearchExaParams = {
  query: string;
  numResults?: number;
};

export type WebFetchExaParams = {
  url: string;
};

export interface ExaSearchResult {
  title?: string;
  url?: string;
  publishedDate?: string | null;
  author?: string | null;
  highlights?: string[];
}

export interface ExaSearchResponse {
  requestId?: string;
  searchType?: string;
  results?: ExaSearchResult[];
}

export interface ExaContentsResult {
  title?: string;
  url?: string;
  text?: string;
}

export interface ExaContentsStatus {
  id?: string;
  status?: string;
  error?: {
    tag?: string;
    httpStatusCode?: number;
  };
}

export interface ExaContentsResponse {
  requestId?: string;
  results?: ExaContentsResult[];
  statuses?: ExaContentsStatus[];
}

export interface ExaToolDetails extends Record<string, unknown> {
  requestId?: string;
  resultCount?: number;
  url?: string;
  truncation?: {
    truncated?: boolean;
  };
}

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

export function getExaApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env.EXA_API_KEY?.trim();
  if (!key) throw new Error("EXA_API_KEY is not configured");
  return key;
}

export function normalizeNumResults(numResults?: number): number {
  if (!Number.isFinite(numResults)) return DEFAULT_NUM_RESULTS;
  return Math.min(MAX_NUM_RESULTS, Math.max(1, Math.floor(numResults!)));
}

export function buildExaSearchRequest(params: WebSearchExaParams) {
  return {
    query: params.query,
    type: "auto",
    numResults: normalizeNumResults(params.numResults),
    contents: {
      highlights: {
        maxCharacters: DEFAULT_HIGHLIGHT_CHARACTERS,
      },
    },
  };
}

export function buildExaContentsRequest(params: WebFetchExaParams) {
  return {
    urls: [params.url],
    text: {
      verbosity: "compact",
    },
  };
}

export async function callExaSearch(
  fetchImpl: typeof fetch,
  apiKey: string,
  params: WebSearchExaParams,
  signal?: AbortSignal,
) {
  const response = await fetchImpl(EXA_SEARCH_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(buildExaSearchRequest(params)),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Exa request failed (${response.status} ${response.statusText}): ${errorText || "No response body"}`,
    );
  }

  return (await response.json()) as ExaSearchResponse;
}

export async function callExaContents(
  fetchImpl: typeof fetch,
  apiKey: string,
  params: WebFetchExaParams,
  signal?: AbortSignal,
) {
  const response = await fetchImpl(EXA_CONTENTS_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(buildExaContentsRequest(params)),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Exa contents request failed (${response.status} ${response.statusText}): ${errorText || "No response body"}`,
    );
  }

  return (await response.json()) as ExaContentsResponse;
}

export function cleanSnippet(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[\.\.\.\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncateSnippet(
  text: string,
  maxLength = MAX_SNIPPET_LENGTH,
): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

export function getBestSnippet(highlights: string[]): string | undefined {
  for (const highlight of highlights) {
    const cleaned = cleanSnippet(highlight);
    if (cleaned) return truncateSnippet(cleaned);
  }
  return undefined;
}

export function formatExaSearchResponse(data: ExaSearchResponse): string {
  const results = data.results ?? [];
  if (results.length === 0) return "No web results found.";

  return results
    .map((result, index) => {
      const title = result.title?.trim() || "Untitled";
      const url = result.url?.trim() || "No URL";
      const snippet =
        getBestSnippet(result.highlights ?? []) || "none provided";
      return `${index + 1}. ${title}\n   URL: ${url}\n   Snippet: ${snippet}`;
    })
    .join("\n\n");
}

export function formatExaContentsResponse(
  data: ExaContentsResponse,
  url: string,
): string {
  const status = data.statuses?.find((item) => item.id === url || !item.id);
  if (status?.status === "error") {
    throw new Error(
      `Exa contents fetch failed for ${url}: ${status.error?.tag || "unknown error"}${status.error?.httpStatusCode ? ` (${status.error.httpStatusCode})` : ""}`,
    );
  }

  const result = data.results?.[0];
  if (!result) return `URL: ${url}\n\nNo content returned.`;

  const title = result.title?.trim();
  const text = result.text?.trim() || "No content returned.";
  return [
    title ? `Title: ${title}` : undefined,
    `URL: ${result.url?.trim() || url}`,
    "",
    text,
  ]
    .filter(Boolean)
    .join("\n");
}

function getCollapsedLabel(input: {
  prefix: string;
  subject?: string;
  resultCount?: number;
  truncated?: boolean;
}) {
  const parts = [input.prefix];
  if (typeof input.resultCount === "number")
    parts.push(`${input.resultCount} result(s)`);
  if (input.subject?.trim()) parts.push(input.subject.trim());
  if (input.truncated) parts.push("[truncated]");
  return parts.join(" ");
}

export function createWebSearchExaTool() {
  return defineTool({
    name: "web_search_exa",
    label: "Web Search Exa",
    description: "Search the web with Exa. Requires EXA_API_KEY.",
    promptSnippet: "Search the web with Exa for current external information",
    promptGuidelines: [
      "Use web_search_exa when you need current external information and compact cited results.",
    ],
    parameters: webSearchExaParams,
    async execute(_toolCallId, params, signal) {
      const apiKey = getExaApiKey();
      const data = await callExaSearch(fetch, apiKey, params, signal);
      const result = buildToolText(
        { requestId: data.requestId, resultCount: data.results?.length ?? 0 },
        formatExaSearchResponse(data),
      );

      return {
        content: [{ type: "text", text: result.text }],
        details: result.details,
      };
    },
    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) {
        return new Text(theme.fg("warning", "Searching the web..."), 0, 0);
      }
      const output =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      const details = (result.details ?? {}) as ExaToolDetails;
      if (expanded) return new Text(output, 0, 0);

      const summary =
        theme.fg("success", "✓ ") +
        theme.fg(
          "muted",
          getCollapsedLabel({
            prefix: "Found",
            resultCount: details.resultCount,
            truncated: !!details.truncation?.truncated,
          }),
        ) +
        "\n" +
        theme.fg("dim", keyHint("app.tools.expand", "to expand"));
      return new Text(summary, 0, 0);
    },
  });
}

export function createWebFetchExaTool() {
  return defineTool({
    name: "web_fetch_exa",
    label: "Web Fetch Exa",
    description: "Fetch and extract a webpage with Exa. Requires EXA_API_KEY.",
    promptSnippet: "Fetch and extract webpage content with Exa",
    promptGuidelines: [
      "Use web_fetch_exa when you already have a URL and need compact extracted page text.",
    ],
    parameters: webFetchExaParams,
    async execute(_toolCallId, params, signal) {
      const apiKey = getExaApiKey();
      const data = await callExaContents(fetch, apiKey, params, signal);
      const result = buildToolText(
        { requestId: data.requestId, url: params.url },
        formatExaContentsResponse(data, params.url),
      );

      return {
        content: [{ type: "text", text: result.text }],
        details: result.details,
      };
    },
    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) {
        return new Text(theme.fg("warning", "Fetching webpage..."), 0, 0);
      }
      const output =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      const details = (result.details ?? {}) as ExaToolDetails;
      if (expanded) return new Text(output, 0, 0);

      const summary =
        theme.fg("success", "✓ ") +
        theme.fg(
          "muted",
          getCollapsedLabel({
            prefix: "Fetched",
            subject: details.url ? String(details.url) : undefined,
            truncated: !!details.truncation?.truncated,
          }),
        ) +
        "\n" +
        theme.fg("dim", keyHint("app.tools.expand", "to expand"));
      return new Text(summary, 0, 0);
    },
  });
}

export default function exaExtension(pi: ExtensionAPI) {
  pi.registerTool(createWebSearchExaTool());
  pi.registerTool(createWebFetchExaTool());
}
