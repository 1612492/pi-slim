const EXA_SEARCH_URL = "https://api.exa.ai/search";
const EXA_CONTENTS_URL = "https://api.exa.ai/contents";
const DEFAULT_NUM_RESULTS = 5;
const MAX_NUM_RESULTS = 10;
const DEFAULT_HIGHLIGHT_CHARACTERS = 600;

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
