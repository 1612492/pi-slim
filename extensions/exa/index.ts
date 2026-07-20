import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  buildToolText,
  renderCollapsedTextResult,
} from "../shared/tool-output.ts";
import {
  callExaContents,
  callExaSearch,
  type ExaContentsResponse,
  type ExaSearchResponse,
} from "./client.ts";
export {
  buildExaContentsRequest,
  buildExaSearchRequest,
  callExaContents,
  callExaSearch,
  normalizeNumResults,
} from "./client.ts";
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

export interface ExaToolDetails extends Record<string, unknown> {
  requestId?: string;
  resultCount?: number;
  url?: string;
  truncation?: {
    truncated?: boolean;
  };
}

export function getExaApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env.EXA_API_KEY?.trim();
  if (!key) throw new Error("EXA_API_KEY is not configured");
  return key;
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
      const details = (result.details ?? {}) as ExaToolDetails;
      return renderCollapsedTextResult({
        result,
        expanded,
        isPartial,
        theme,
        partialLabel: "Searching the web...",
        summaryLabel: getCollapsedLabel({
          prefix: "Found",
          resultCount: details.resultCount,
          truncated: !!details.truncation?.truncated,
        }),
      });
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
      const details = (result.details ?? {}) as ExaToolDetails;
      return renderCollapsedTextResult({
        result,
        expanded,
        isPartial,
        theme,
        partialLabel: "Fetching webpage...",
        summaryLabel: getCollapsedLabel({
          prefix: "Fetched",
          subject: details.url ? String(details.url) : undefined,
          truncated: !!details.truncation?.truncated,
        }),
      });
    },
  });
}

export default function exaExtension(pi: ExtensionAPI) {
  pi.registerTool(createWebSearchExaTool());
  pi.registerTool(createWebFetchExaTool());
}
