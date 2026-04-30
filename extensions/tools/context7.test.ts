import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildContext7DocsUrl,
  buildContext7Headers,
  buildContext7SearchUrl,
  createQueryDocsTool,
  createResolveLibraryIdTool,
  formatContext7DocsOutput,
  formatResolveLibraryIdOutput,
  getContext7ApiKey,
  normalizeContext7DocsText,
  queryContext7Docs,
  resolveContext7Library,
} from "./context7.js";

describe("context7 tools", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CONTEXT7_API_KEY;
  });

  it("requires CONTEXT7_API_KEY", async () => {
    expect(() => getContext7ApiKey({} as NodeJS.ProcessEnv)).toThrow(
      "CONTEXT7_API_KEY is not configured",
    );
  });

  it("builds auth header", () => {
    expect(buildContext7Headers("ctx7")).toEqual({
      authorization: "Bearer ctx7",
    });
  });

  it("builds resolve and docs URLs", () => {
    expect(
      buildContext7SearchUrl({ libraryName: "react", query: "hooks" }),
    ).toContain("/api/v2/libs/search?libraryName=react&query=hooks");
    expect(
      buildContext7DocsUrl({ libraryId: "/facebook/react", query: "hooks" }),
    ).toContain(
      "/api/v2/context?libraryId=%2Ffacebook%2Freact&query=hooks&type=txt",
    );
  });

  it("formats resolve output", () => {
    const text = formatResolveLibraryIdOutput({
      id: "/facebook/react",
      title: "React",
      description: "UI library",
    });

    expect(text).toContain("Library ID: /facebook/react");
    expect(text).toContain("Library: React");
    expect(text).toContain("Description: UI library");
  });

  it("formats docs output", () => {
    const text = formatContext7DocsOutput({
      libraryId: "/facebook/react",
      docsText: "useEffect docs",
    });
    expect(text).toContain("Library ID: /facebook/react");
    expect(text).toContain("useEffect docs");
  });

  it("normalizes docs text spacing", () => {
    expect(normalizeContext7DocsText("a\n\n\n\n b  \n")).toBe("a\n\n b");
  });

  it("resolves library ids", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [{ id: "/facebook/react", title: "React" }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const resolved = await resolveContext7Library(
      fetchMock as typeof fetch,
      "ctx7",
      {
        libraryName: "react",
        query: "hooks",
      },
    );

    expect(resolved.id).toBe("/facebook/react");
  });

  it("queries docs by library id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("hooks docs", { status: 200 }));
    const docs = await queryContext7Docs(fetchMock as typeof fetch, "ctx7", {
      libraryId: "/facebook/react",
      query: "hooks",
    });
    expect(docs).toBe("hooks docs");
  });

  it("resolve-library-id tool uses the resolve endpoint", async () => {
    process.env.CONTEXT7_API_KEY = "ctx7";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [{ id: "/facebook/react", title: "React" }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = createResolveLibraryIdTool(() => "demo");
    const result = await tool.execute(
      "1",
      { libraryName: "react", query: "hooks" },
      undefined,
      undefined,
      {} as never,
    );

    expect(fetchMock.mock.calls[0]?.[0]).toContain("/api/v2/libs/search?");
    expect(result.content[0]).toEqual(
      expect.objectContaining({ type: "text" }),
    );
  });

  it("query-docs tool uses the docs endpoint", async () => {
    process.env.CONTEXT7_API_KEY = "ctx7";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("hooks docs", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const tool = createQueryDocsTool(() => "demo");
    const result = await tool.execute(
      "1",
      { libraryId: "/facebook/react", query: "hooks" },
      undefined,
      undefined,
      {} as never,
    );

    expect(fetchMock.mock.calls[0]?.[0]).toContain("/api/v2/context?");
    expect(result.content[0]).toEqual(
      expect.objectContaining({ type: "text" }),
    );
  });

  it("surfaces not found libraries clearly", async () => {
    const fetchMock = vi.mocked(
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(
      resolveContext7Library(fetchMock as typeof fetch, "ctx7", {
        libraryName: "missing",
        query: "hooks",
      }),
    ).rejects.toThrow('No Context7 library found for "missing"');
  });

  it("reads CONTEXT7_API_KEY from env", () => {
    process.env.CONTEXT7_API_KEY = "ctx7";
    expect(getContext7ApiKey()).toBe("ctx7");
  });
});
