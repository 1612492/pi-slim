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

const EXA_API_URL = "https://api.exa.ai/search";
const DEFAULT_NUM_RESULTS = 5;
const MAX_NUM_RESULTS = 10;
const DEFAULT_HIGHLIGHT_CHARACTERS = 600;
const EXA_SUPPORTED_CATEGORIES = new Set([
  "company",
  "research paper",
  "news",
  "pdf",
  "personal site",
  "github",
  "tweet",
  "movie",
  "song",
]);
const EXA_CATEGORY_ALIASES: Record<string, string | undefined> = {
  general: undefined,
  documentation: undefined,
  docs: undefined,
  doc: undefined,
};

export const websearchParams = Type.Object({
  query: Type.String({ description: "Natural-language web search query" }),
  numResults: Type.Optional(
    Type.Number({ description: "Max results to return (1-10)" }),
  ),
  includeDomains: Type.Optional(
    Type.Array(Type.String({ description: "Domain to prefer" })),
  ),
  excludeDomains: Type.Optional(
    Type.Array(Type.String({ description: "Domain to exclude" })),
  ),
  category: Type.Optional(
    Type.String({
      description:
        "Optional Exa result category. Unsupported values like general or documentation are ignored.",
    }),
  ),
});

export type WebsearchParams = {
  query: string;
  numResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  category?: string;
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

export interface WebsearchToolDetails extends Record<string, unknown> {
  requestId?: string;
  searchType?: string;
  resultCount?: number;
  truncation?: {
    truncated?: boolean;
  };
  fullOutputPath?: string;
}

const MAX_SNIPPET_LENGTH = 240;

export function getExaApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env.EXA_API_KEY?.trim();
  if (!key) throw new Error("EXA_API_KEY is not configured");
  return key;
}

export function normalizeNumResults(numResults?: number): number {
  if (!Number.isFinite(numResults)) return DEFAULT_NUM_RESULTS;
  return Math.min(MAX_NUM_RESULTS, Math.max(1, Math.floor(numResults!)));
}

export function normalizeCategory(category?: string): string | undefined {
  const normalized = category?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized in EXA_CATEGORY_ALIASES) {
    return EXA_CATEGORY_ALIASES[normalized];
  }
  return EXA_SUPPORTED_CATEGORIES.has(normalized) ? normalized : undefined;
}

export function buildExaSearchRequest(params: WebsearchParams) {
  return {
    query: params.query,
    type: "auto",
    numResults: normalizeNumResults(params.numResults),
    includeDomains: params.includeDomains?.length
      ? params.includeDomains
      : undefined,
    excludeDomains: params.excludeDomains?.length
      ? params.excludeDomains
      : undefined,
    category: normalizeCategory(params.category),
    contents: {
      highlights: {
        maxCharacters: DEFAULT_HIGHLIGHT_CHARACTERS,
      },
    },
  };
}

export function formatExaSearchResponse(data: ExaSearchResponse): string {
  const lines: string[] = [];

  if (data.requestId) lines.push(`Request ID: ${data.requestId}`);
  if (data.searchType) lines.push(`Search type: ${data.searchType}`);
  if (lines.length > 0) lines.push("");

  const results = data.results ?? [];
  if (results.length === 0) {
    lines.push("No web results found.");
    return lines.join("\n");
  }

  results.forEach((result, index) => {
    const title = result.title?.trim() || "Untitled";
    const url = result.url?.trim() || "No URL";
    const meta = [result.publishedDate, result.author]
      .filter(Boolean)
      .join(" • ");
    const snippet = getBestSnippet(result.highlights ?? []);

    lines.push(`${index + 1}. ${title}`);
    lines.push(`   URL: ${url}`);
    if (meta) lines.push(`   Meta: ${meta}`);
    if (!snippet) {
      lines.push("   Snippet: none provided");
    } else {
      lines.push(`   Snippet: ${snippet}`);
    }
    lines.push("");
  });

  return lines.join("\n").trim();
}

export function cleanSnippet(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[\.\.\.\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncateSnippet(text: string, maxLength = MAX_SNIPPET_LENGTH): string {
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

export function getWebsearchCollapsedLabel(input: {
  query?: string;
  resultCount?: number;
  truncated?: boolean;
}) {
  const parts = [`Found ${input.resultCount ?? 0} web result(s)`];
  if (input.query?.trim()) parts.push(`for \"${input.query.trim()}\"`);
  if (input.truncated) parts.push("[truncated]");
  return parts.join(" ");
}

export async function buildTruncatedToolText(
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

export async function callExaSearch(
  fetchImpl: typeof fetch,
  apiKey: string,
  params: WebsearchParams,
  signal?: AbortSignal,
) {
  const response = await fetchImpl(EXA_API_URL, {
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

export const websearchTool = defineTool({
  name: "websearch",
  label: "Web Search",
  description: `Search the web with Exa. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}. Requires EXA_API_KEY.`,
  promptSnippet:
    "Search the web with Exa for current external information and cited sources",
  promptGuidelines: [
    "Use websearch when the user asks for current events, external documentation, web facts, or sources outside the workspace.",
    "Use websearch instead of guessing when freshness matters.",
  ],
  parameters: websearchParams,
  async execute(_toolCallId, params, signal) {
    const apiKey = getExaApiKey();
    const data = await callExaSearch(fetch, apiKey, params, signal);
    const formatted = formatExaSearchResponse(data);
    const result = await buildTruncatedToolText(
      {
        requestId: data.requestId,
        searchType: data.searchType,
        resultCount: data.results?.length ?? 0,
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
      return new Text(theme.fg("warning", "Searching the web..."), 0, 0);
    }

    const text = result.content[0];
    const output = text?.type === "text" ? text.text : "";
    const details = (result.details ?? {}) as WebsearchToolDetails;

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
        getWebsearchCollapsedLabel({
          query,
          resultCount: details.resultCount,
          truncated: !!details.truncation?.truncated,
        }),
      );

    if (details.requestId) {
      summary += "\n" + theme.fg("dim", `Request ID: ${details.requestId}`);
    }

    summary +=
      "\n" + theme.fg("dim", keyHint("app.tools.expand", "to expand"));

    return new Text(summary, 0, 0);
  },
});
