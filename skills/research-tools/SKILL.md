---
name: research-tools
description: Use Context7 and Exa tools efficiently for docs lookup, web research, and context-efficient follow-up fetching.
---

# Research Tools

Use the smallest tool that can answer the question.

## Default decision rule

- If the question is about a library, framework, SDK, or API docs, use Context7.
- If the question is about current external information or finding URLs on the web, use Exa.
- Do not use web search first for library docs unless Context7 cannot answer it.

## Context7

Use Context7 for library, framework, and SDK documentation.

### Required order

1. If you only know the library name, call `resolve-library-id` first.
2. Then call `query-docs` with the resolved library id.
3. Do not skip directly to web search for normal docs lookup.

### Prefer Context7 when

- The user asks how a library or framework works.
- API details, examples, or current docs matter.
- Version-specific behavior is important.

### Context7 workflow

1. Resolve the library id once.
2. Query docs with a focused question.
3. Every tool call saves full output to the session-scoped tool cache. Use the returned cache file path when you need to inspect more detail.
4. Only fall back to Exa if Context7 is missing the needed information.

## Exa

Use Exa for general web research and external pages.

### Required order

1. Call `web_search_exa` first to find relevant sources.
2. Call `web_fetch_exa` only for a specific URL worth expanding.
3. Do not fetch pages blindly before search unless the user already gave the exact URL.

### Prefer Exa when

- The user needs current external information.
- You need to find relevant URLs before reading one.
- The question is not primarily about a software library API.

### Exa workflow

1. Start with `web_search_exa`.
2. Review the returned titles, URLs, and snippets.
3. Pick one URL.
4. Call `web_fetch_exa` only if deeper page content is needed.
5. Every tool call saves full output to the session-scoped tool cache. Use the returned cache file path before refetching.

## Context efficiency rules

- Prefer `query-docs` over web search for library docs.
- Prefer `web_search_exa` over `web_fetch_exa`.
- Fetch one URL at a time.
- Avoid repeated fetches for the same page unless necessary.
- Use the cached output path instead of refetching when possible.
- Avoid parallel fetches unless the task truly requires comparing multiple specific pages.
- Do not call both Context7 and Exa for the same simple question unless the first source is insufficient.
- Read cached files only when the preview is insufficient; avoid immediately reading the full file back into context.

## Tool selection summary

- Library/package docs question → `resolve-library-id` → `query-docs`
- General web research question → `web_search_exa`
- Need full content from one known page → `web_fetch_exa`
