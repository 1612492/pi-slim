import { defineTool, keyHint } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";
import { buildCachedToolText, createCacheWriter } from "./cache.js";

const CONTEXT7_BASE_URL = "https://context7.com/api/v2";

export const resolveLibraryIdParams = Type.Object({
  libraryName: Type.String({
    description: "Library name to resolve, like react or next.js",
  }),
  query: Type.String({ description: "What you need from the docs" }),
});

export const queryDocsParams = Type.Object({
  libraryId: Type.String({
    description: "Explicit Context7 library id like /vercel/next.js",
  }),
  query: Type.String({ description: "Documentation question to answer" }),
});

export type ResolveLibraryIdParams = {
  libraryName: string;
  query: string;
};

export type QueryDocsParams = {
  libraryId: string;
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

export function buildContext7SearchUrl(params: ResolveLibraryIdParams) {
  const url = new URL(`${CONTEXT7_BASE_URL}/libs/search`);
  url.searchParams.set("libraryName", params.libraryName);
  url.searchParams.set("query", params.query);
  return url.toString();
}

export function buildContext7DocsUrl(params: QueryDocsParams) {
  const url = new URL(`${CONTEXT7_BASE_URL}/context`);
  url.searchParams.set("libraryId", params.libraryId);
  url.searchParams.set("query", params.query);
  url.searchParams.set("type", "txt");
  return url.toString();
}

export async function resolveContext7Library(
  fetchImpl: typeof fetch,
  apiKey: string,
  params: ResolveLibraryIdParams,
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
  if (!bestMatch) {
    throw new Error(`No Context7 library found for "${params.libraryName}"`);
  }
  return bestMatch;
}

export async function queryContext7Docs(
  fetchImpl: typeof fetch,
  apiKey: string,
  params: QueryDocsParams,
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

export function normalizeContext7DocsText(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function formatResolveLibraryIdOutput(result: Context7LibraryResult) {
  const lines = [
    `Library ID: ${result.id}`,
    result.title ? `Library: ${result.title}` : undefined,
    result.description ? `Description: ${result.description}` : undefined,
    "",
    `Selected the best Context7 match for ${JSON.stringify(result.title || result.id)}.`,
  ].filter(Boolean);
  return lines.join("\n");
}

export function formatContext7DocsOutput(result: {
  libraryId: string;
  docsText: string;
}) {
  return `Library ID: ${result.libraryId}\n\n${normalizeContext7DocsText(result.docsText)}`.trim();
}

function getCollapsedLabel(input: {
  prefix: string;
  subject?: string;
  query?: string;
  truncated?: boolean;
}) {
  const parts = [input.prefix];
  if (input.subject?.trim()) parts.push(input.subject.trim());
  if (input.query?.trim()) parts.push(`for \"${input.query.trim()}\"`);
  if (input.truncated) parts.push("[truncated]");
  return parts.join(" ");
}

export function createResolveLibraryIdTool(
  getSessionName: () => string | undefined,
) {
  return defineTool({
    name: "resolve-library-id",
    label: "Resolve Library ID",
    description:
      "Resolve the best Context7 library ID for a library name. Requires CONTEXT7_API_KEY.",
    promptSnippet: "Resolve a Context7 library id before querying docs",
    promptGuidelines: [
      "Use resolve-library-id before query-docs when you only know the package name.",
    ],
    parameters: resolveLibraryIdParams,
    async execute(_toolCallId, params, signal) {
      const apiKey = getContext7ApiKey();
      const resolved = await resolveContext7Library(
        fetch,
        apiKey,
        params,
        signal,
      );
      return {
        content: [
          { type: "text", text: formatResolveLibraryIdOutput(resolved) },
        ],
        details: {
          libraryId: resolved.id,
          libraryTitle: resolved.title,
          libraryDescription: resolved.description,
        },
      };
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (isPartial) {
        return new Text(theme.fg("warning", "Resolving library..."), 0, 0);
      }

      const output =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      const details = (result.details ?? {}) as Context7ToolDetails;
      if (expanded) return new Text(output, 0, 0);

      const query =
        typeof context.args === "object" &&
        context.args &&
        "query" in context.args
          ? String((context.args as { query?: string }).query ?? "")
          : "";
      const summary =
        theme.fg("success", "✓ ") +
        theme.fg(
          "muted",
          getCollapsedLabel({
            prefix: "Resolved",
            subject: details.libraryTitle || details.libraryId,
            query,
          }),
        ) +
        "\n" +
        theme.fg("dim", keyHint("app.tools.expand", "to expand"));

      return new Text(summary, 0, 0);
    },
  });
}

export function createQueryDocsTool(getSessionName: () => string | undefined) {
  const cacheWriter = createCacheWriter(getSessionName);
  return defineTool({
    name: "query-docs",
    label: "Query Docs",
    description:
      "Query Context7 docs for a resolved library ID. Requires CONTEXT7_API_KEY.",
    promptSnippet: "Query Context7 docs by library id",
    promptGuidelines: [
      "Use query-docs after resolve-library-id when you need current library documentation.",
    ],
    parameters: queryDocsParams,
    async execute(_toolCallId, params, signal) {
      const apiKey = getContext7ApiKey();
      const docsText = await queryContext7Docs(fetch, apiKey, params, signal);
      const formatted = formatContext7DocsOutput({
        libraryId: params.libraryId,
        docsText,
      });
      const result = await buildCachedToolText(
        cacheWriter,
        { libraryId: params.libraryId },
        formatted,
        { category: "tools", prefix: "query-docs" },
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

      const output =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      const details = (result.details ?? {}) as Context7ToolDetails;
      if (expanded) return new Text(output, 0, 0);

      const query =
        typeof context.args === "object" &&
        context.args &&
        "query" in context.args
          ? String((context.args as { query?: string }).query ?? "")
          : "";
      const summary =
        theme.fg("success", "✓ ") +
        theme.fg(
          "muted",
          getCollapsedLabel({
            prefix: "Docs for",
            subject: details.libraryId,
            query,
            truncated: !!details.truncation?.truncated,
          }),
        ) +
        "\n" +
        theme.fg("dim", keyHint("app.tools.expand", "to expand"));

      return new Text(summary, 0, 0);
    },
  });
}
