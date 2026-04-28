import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildContext7DocsUrl,
  buildContext7Headers,
  buildContext7SearchUrl,
  context7Tool,
  formatContext7Output,
  getContext7CollapsedLabel,
  getContext7ApiKey,
  normalizeContext7DocsText,
  queryContext7Docs,
  resolveContext7Library,
} from "./context7.js";

describe("context7 tool", () => {
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
      buildContext7SearchUrl({ library: "react", query: "hooks" }),
    ).toContain("/api/v2/libs/search?libraryName=react&query=hooks");
    expect(
      buildContext7DocsUrl({ libraryId: "/facebook/react", query: "hooks" }),
    ).toContain(
      "/api/v2/context?libraryId=%2Ffacebook%2Freact&query=hooks&type=txt",
    );
  });

  it("formats docs output", () => {
    const text = formatContext7Output({
      libraryId: "/facebook/react",
      libraryTitle: "React",
      libraryDescription: "UI library",
      docsText: "useEffect docs",
    });

    expect(text).toContain("Library: React");
    expect(text).toContain("Library ID: /facebook/react");
    expect(text).toContain("Description: UI library");
    expect(text).toContain("useEffect docs");
  });

  it("normalizes docs text spacing", () => {
    expect(normalizeContext7DocsText("a\n\n\n\n b  \n")).toBe("a\n\n b");
  });

  it("builds a compact collapsed summary label", () => {
    expect(
      getContext7CollapsedLabel({
        libraryTitle: "React",
        query: "useEffect cleanup",
      }),
    ).toBe('Docs for React for "useEffect cleanup"');
  });

  it("marks collapsed summary label as truncated when needed", () => {
    expect(
      getContext7CollapsedLabel({ libraryId: "/facebook/react", truncated: true }),
    ).toBe("Docs for /facebook/react [truncated]");
  });

  it("resolves library before querying docs", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [{ id: "/facebook/react", title: "React" }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(new Response("hooks docs", { status: 200 }));

    const resolved = await resolveContext7Library(
      fetchMock as typeof fetch,
      "ctx7",
      {
        library: "react",
        query: "hooks",
      },
    );
    const docs = await queryContext7Docs(fetchMock as typeof fetch, "ctx7", {
      libraryId: resolved.id,
      query: "hooks",
    });

    expect(resolved.id).toBe("/facebook/react");
    expect(docs).toBe("hooks docs");
  });

  it("skips resolve when libraryId is provided", async () => {
    process.env.CONTEXT7_API_KEY = "ctx7";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("hooks docs", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await context7Tool.execute(
      "1",
      { libraryId: "/facebook/react", query: "hooks" },
      undefined,
      undefined,
      {} as never,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
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
        library: "missing",
        query: "hooks",
      }),
    ).rejects.toThrow('No Context7 library found for "missing"');
  });

  it("reads CONTEXT7_API_KEY from env", () => {
    process.env.CONTEXT7_API_KEY = "ctx7";
    expect(getContext7ApiKey()).toBe("ctx7");
  });
});
