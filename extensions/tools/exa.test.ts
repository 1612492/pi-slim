import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildExaContentsRequest,
  buildExaSearchRequest,
  callExaContents,
  callExaSearch,
  cleanSnippet,
  createWebFetchExaTool,
  createWebSearchExaTool,
  formatExaContentsResponse,
  formatExaSearchResponse,
  getBestSnippet,
  getExaApiKey,
  normalizeNumResults,
  truncateSnippet,
} from "./exa.js";

describe("exa tools", () => {
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
      }),
    ).toEqual({
      query: "latest pi docs",
      type: "auto",
      numResults: 10,
      contents: { highlights: { maxCharacters: 600 } },
    });
  });

  it("builds Exa contents request body", () => {
    expect(
      buildExaContentsRequest({ url: "https://example.com/article" }),
    ).toEqual({
      urls: ["https://example.com/article"],
      text: { verbosity: "compact" },
    });
  });

  it("formats Exa results", () => {
    const text = formatExaSearchResponse({
      results: [
        {
          title: "Pi docs",
          url: "https://example.com",
          highlights: ["First", "Second", "Third"],
        },
      ],
    });

    expect(text).toContain("1. Pi docs");
    expect(text).toContain("URL: https://example.com");
    expect(text).toContain("Snippet: First");
    expect(text).not.toContain("Third");
  });

  it("formats Exa contents results", () => {
    const text = formatExaContentsResponse(
      {
        results: [
          {
            title: "Pi docs",
            url: "https://example.com",
            text: "full text",
          },
        ],
      },
      "https://example.com",
    );

    expect(text).toContain("Title: Pi docs");
    expect(text).toContain("URL: https://example.com");
    expect(text).toContain("full text");
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

  it("sends x-api-key header to Exa search", async () => {
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

  it("sends x-api-key header to Exa contents", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await callExaContents(fetchMock as typeof fetch, "secret", {
      url: "https://example.com",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.exa.ai/contents",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-api-key": "secret" }),
      }),
    );
  });

  it("surfaces Exa search API failures clearly", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("bad key", { status: 401, statusText: "Unauthorized" }),
      );

    await expect(
      callExaSearch(fetchMock as typeof fetch, "secret", { query: "hello" }),
    ).rejects.toThrow("Exa request failed (401 Unauthorized): bad key");
  });

  it("surfaces Exa contents API failures clearly", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("bad key", { status: 401, statusText: "Unauthorized" }),
      );

    await expect(
      callExaContents(fetchMock as typeof fetch, "secret", {
        url: "https://example.com",
      }),
    ).rejects.toThrow(
      "Exa contents request failed (401 Unauthorized): bad key",
    );
  });

  it("web_search_exa tool uses the search endpoint", async () => {
    process.env.EXA_API_KEY = "abc123";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = createWebSearchExaTool(() => "demo");
    const result = await tool.execute(
      "1",
      { query: "hello" },
      undefined,
      undefined,
      {} as never,
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.exa.ai/search");
    expect(result.content[0]).toEqual(
      expect.objectContaining({ type: "text" }),
    );
  });

  it("web_fetch_exa tool uses the contents endpoint", async () => {
    process.env.EXA_API_KEY = "abc123";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [{ url: "https://example.com", text: "body" }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = createWebFetchExaTool(() => "demo");
    const result = await tool.execute(
      "1",
      { url: "https://example.com" },
      undefined,
      undefined,
      {} as never,
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.exa.ai/contents");
    expect(result.content[0]).toEqual(
      expect.objectContaining({ type: "text" }),
    );
  });

  it("reads EXA_API_KEY from env", () => {
    process.env.EXA_API_KEY = "abc123";
    expect(getExaApiKey()).toBe("abc123");
  });
});
