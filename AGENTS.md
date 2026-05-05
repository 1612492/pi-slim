# AGENTS.md

This project extends Pi with Context7 and Exa tools, runtime plan mode, focused repo-owned subagents, and compact tool-output handling.

## Priorities

1. Optimize for context efficiency.
2. Prefer the smallest tool that can answer the question.
3. Avoid injecting large external content directly into the conversation.
4. Keep tool output compact in-context.

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

### Plan mode workflow

Use runtime plan mode instead of persisted session plans.

Required behavior:

1. `/plan` toggles read-only planning mode.
2. Planning output should contain a numbered `Plan:` section.
3. Execution mode tracks completion with `[DONE:n]`.
4. Do not recreate the old `current-plan.md` workflow.

### Subagents

- `subagent`

Use this for focused delegated work.

Repo-owned agents:

1. `explorer` for local code discovery
2. `librarian` for docs and research
3. `fixer` for isolated implementation
4. `oracle` for review and strategy

Rules:

1. Planning stays in the main session unless the user explicitly wants delegation.
2. Prefer `explorer` and `librarian` for bounded retrieval.
3. Prefer `fixer` for scoped implementation.
4. Prefer `oracle` for review, risk analysis, and simplification.

## Context-efficiency rules

1. Prefer `query-docs` over web search for software documentation.
2. Prefer `web_search_exa` over `web_fetch_exa`.
3. Fetch one page at a time unless comparison is necessary.
4. Avoid repeated fetches for the same page unless necessary.
5. Do not call both Context7 and Exa for the same simple question unless the first source is insufficient.
6. Do not reintroduce persisted session-plan files as the primary workflow.
7. Prefer compact handoffs from `explorer`, `librarian`, `fixer`, and `oracle` over copying large raw outputs into the main session.

## Working on this project

1. Keep tool interfaces simple.
2. Prefer fetch-based integrations over MCP in this repo unless requirements change.
3. Preserve context-efficiency behavior when modifying tools.
4. If adding new tools, return compact previews by default when appropriate.
5. If a change increases output verbosity, justify it and keep the default path compact.
6. Keep the runtime workflow explicit: `/plan` for read-only planning, then execute with tracked `[DONE:n]` steps when ready.
