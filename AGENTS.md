# AGENTS.md

This project extends Pi with Context7 and Exa tools, focused child-Pi subagents, and a session-scoped cache layer.

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

### Session plan workflow

- `write_plan`
- `read_current_plan`

Use these for the one-plan-per-session workflow.

Required behavior:

1. `/plan` is for drafting and revising the working plan in conversation.
2. `/finalize-plan` should call `write_plan` to persist the approved plan.
3. `/build` should call `read_current_plan` first and implement from the latest finalized session plan.
4. Keep one active finalized plan per Pi session.

Plan file behavior:

1. The canonical session plan lives at `current-plan.md`.
2. Finalized snapshots are versioned with meaningful task-based names like `<task-slug>-v2.md`.
3. Plans are persistent and should not be cleared on session shutdown.

### Child Pi subagents

- `spawn_pi_subagent`

Use this only for focused retrieval.

Available child roles:

1. `explorer` for local code discovery
2. `librarian` for external docs and research

Rules:

1. `Planner` stays in the main session.
2. `Builder` stays in the main session.
3. Only `Explorer` and `Librarian` are child Pi runs.
4. Use child Pi runs only when narrower and cheaper than broad main-session retrieval.

## Context-efficiency rules

1. Prefer `query-docs` over web search for software documentation.
2. Prefer `web_search_exa` over `web_fetch_exa`.
3. Fetch one page at a time unless comparison is necessary.
4. Avoid repeated fetches for the same page when a cached file path already exists.
5. Read cached files only when the preview is insufficient.
6. When reading cached files, read only the relevant sections or smaller slices instead of the full file when possible.
7. Do not call both Context7 and Exa for the same simple question unless the first source is insufficient.
8. Prefer reading `current-plan.md` over reconstructing plan state from conversation when building or revising a finalized plan.
9. Do not write to the `plans/` cache except through the explicit plan-finalization workflow.

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
5. `plans/` should contain canonical plan artifacts, not arbitrary temporary tool output.

## Working on this project

1. Keep tool interfaces simple.
2. Prefer fetch-based integrations over MCP in this repo unless requirements change.
3. Preserve context-efficiency behavior when modifying tools.
4. If adding new tools, make them cache-aware and return compact previews.
5. If a change increases output verbosity, justify it and keep the default path compact.
6. Keep the planner/builder workflow explicit: `/plan` -> `/finalize-plan` -> `/build`.
