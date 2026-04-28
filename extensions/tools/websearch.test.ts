import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildExaSearchRequest,
  callExaSearch,
  cleanSnippet,
  formatExaSearchResponse,
  getExaApiKey,
  getBestSnippet,
  getWebsearchCollapsedLabel,
  normalizeCategory,
  normalizeNumResults,
  truncateSnippet,
  websearchTool,
} from "./websearch.js";

describe("websearch tool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.EXA_API_KEY;
  });

  it("requires EXA_API_KEY", async () => {
    expect(() => getExaApiKey({} as NodeJS.ProcessEnv)).toThrow(
      "EXA_API_KEY is not configured",
    );
  });

  it("normalizes numResults into Exa limits", () => {
    expect(normalizeNumResults()).toBe(5);
    expect(normalizeNumResults(0)).toBe(1);
    expect(normalizeNumResults(20)).toBe(10);
  });

  it("builds Exa search request body", () => {
    expect(
      buildExaSearchRequest({
        query: "latest pi docs",
        numResults: 12,
        includeDomains: ["exa.ai"],
        excludeDomains: ["reddit.com"],
        category: "news",
      }),
    ).toEqual({
      query: "latest pi docs",
      type: "auto",
      numResults: 10,
      includeDomains: ["exa.ai"],
      excludeDomains: ["reddit.com"],
      category: "news",
      contents: { highlights: { maxCharacters: 600 } },
    });
  });

  it('normalizes category "general" to no filter', () => {
    expect(normalizeCategory("general")).toBeUndefined();
    expect(
      buildExaSearchRequest({ query: "latest pi docs", category: "general" })
        .category,
    ).toBeUndefined();
  });

  it('normalizes category "documentation" to no filter', () => {
    expect(normalizeCategory("documentation")).toBeUndefined();
    expect(
      buildExaSearchRequest({
        query: "latest pi docs",
        category: "documentation",
      }).category,
    ).toBeUndefined();
  });

  it("keeps supported Exa categories", () => {
    expect(normalizeCategory("news")).toBe("news");
  });

  it("builds a compact collapsed summary label", () => {
    expect(
      getWebsearchCollapsedLabel({ query: "Exa API docs", resultCount: 5 }),
    ).toBe('Found 5 web result(s) for "Exa API docs"');
  });

  it("marks collapsed summary label as truncated when needed", () => {
    expect(getWebsearchCollapsedLabel({ resultCount: 2, truncated: true })).toBe(
      "Found 2 web result(s) [truncated]",
    );
  });

  it("formats Exa results", () => {
    const text = formatExaSearchResponse({
      requestId: "req_1",
      searchType: "auto",
      results: [
        {
          title: "Pi docs",
          url: "https://example.com",
          publishedDate: "2026-01-01",
          author: "Example",
          highlights: ["First", "Second", "Third"],
        },
      ],
    });

    expect(text).toContain("Request ID: req_1");
    expect(text).toContain("1. Pi docs");
    expect(text).toContain("URL: https://example.com");
    expect(text).toContain("Meta: 2026-01-01 • Example");
    expect(text).toContain("Snippet: First");
    expect(text).not.toContain("Third");
  });

  it("cleans and compacts noisy snippets", () => {
    expect(cleanSnippet("foo\n[...]\n```bash\nbar\n```\n baz")).toBe("foo baz");
  });

  it("truncates long snippets", () => {
    expect(truncateSnippet("abcdefghij", 6)).toBe("abcde…");
  });

  it("picks the first usable snippet", () => {
    expect(getBestSnippet(["   ", "Hello\n[...] world"])).toBe("Hello world");
  });

  it("sends x-api-key header to Exa", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await callExaSearch(fetchMock as typeof fetch, "secret", {
      query: "hello",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.exa.ai/search",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-api-key": "secret" }),
      }),
    );
  });

  it("surfaces Exa API failures clearly", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("bad key", { status: 401, statusText: "Unauthorized" }),
      );

    await expect(
      callExaSearch(fetchMock as typeof fetch, "secret", { query: "hello" }),
    ).rejects.toThrow("Exa request failed (401 Unauthorized): bad key");
  });

  it("reads EXA_API_KEY from env", () => {
    process.env.EXA_API_KEY = "abc123";
    expect(getExaApiKey()).toBe("abc123");
  });
});
