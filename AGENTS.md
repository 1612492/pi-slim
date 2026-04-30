# AGENTS.md

This project extends Pi with Context7 and Exa tools plus a session-scoped cache layer.

## Priorities

1. Optimize for context efficiency.
2. Prefer the smallest tool that can answer the question.
3. Avoid injecting large external content directly into the conversation.
4. Use cached file paths when deeper inspection is needed.

## Available project tools

### Context7

- `resolve-library-id`
- `query-docs`

Use these for library, framework, and SDK documentation.

Required order:

1. `resolve-library-id` when only the library name is known.
2. `query-docs` with the resolved library id.

Do not use web search first for normal library docs lookup unless Context7 is insufficient.

### Exa

- `web_search_exa`
- `web_fetch_exa`

Use these for general web research and external pages.

Required order:

1. `web_search_exa` first when you need to discover relevant sources.
2. `web_fetch_exa` only when you already have a target URL or need to expand one search result.

Do not fetch pages blindly before search unless the user already provided the exact URL.

## Context-efficiency rules

1. Prefer `query-docs` over web search for software documentation.
2. Prefer `web_search_exa` over `web_fetch_exa`.
3. Fetch one page at a time unless comparison is necessary.
4. Avoid repeated fetches for the same page when a cached file path already exists.
5. Read cached files only when the preview is insufficient.
6. When reading cached files, read only the relevant sections or smaller slices instead of the full file when possible.
7. Do not call both Context7 and Exa for the same simple question unless the first source is insufficient.

## Cache behavior

Tool outputs are saved to a session-scoped cache under:

- `$HOME/.cache/pi/tools/<session-dir>/<session-file-stem>/...`

Plan outputs are intended to live under:

- `$HOME/.cache/pi/plans/<session-dir>/<session-file-stem>/...`

Rules:

1. Tool calls return a preview plus a cache file path.
2. The cache file contains the full tool output.
3. Tool cache is ephemeral and clears on session shutdown.
4. Plan cache is persistent and should not be treated like disposable tool output.

## Working on this project

1. Keep tool interfaces simple.
2. Prefer fetch-based integrations over MCP in this repo unless requirements change.
3. Preserve context-efficiency behavior when modifying tools.
4. If adding new tools, make them cache-aware and return compact previews.
5. If a change increases output verbosity, justify it and keep the default path compact.
