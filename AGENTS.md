# AGENTS.md

This project extends Pi with Context7 and Exa tools, questionnaire-driven clarification, runtime plan mode, focused repo-owned subagents, and compact tool-output handling.

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

### Questionnaire

- `questionnaire`

Use this to ask structured clarifying questions in interactive sessions.

Required behavior:

1. Use it when requirements are ambiguous, tradeoffs need user input, or preferences must be chosen explicitly.
2. Prefer concise options with short labels and helpful descriptions.
3. In plan mode, use `questionnaire` instead of making large assumptions.

### Plan mode workflow

Use runtime plan mode instead of persisted session plans.

Required behavior:

1. `Ctrl+\\` toggles read-only planning mode.
2. Planning output should contain a numbered `Plan:` section.
3. Execution mode tracks completion with `[DONE:n]`.
4. Do not recreate the old `current-plan.md` workflow.
5. Plan mode may use `subagent` only for bounded read-only delegation.
6. Do not use `subagent` to bypass read-only planning restrictions.

### Subagents

- `subagent`

Use this for focused delegated work.

Repo-owned agents:

1. `explorer` for local code discovery
2. `librarian` for docs and research
3. `oracle` for review and strategy
4. `fixer` for isolated implementation in build mode

Rules:

1. Planning stays in the main session unless the user explicitly wants delegation.
2. Prefer `explorer` and `librarian` for bounded retrieval.
3. Prefer `oracle` for review, risk analysis, and simplification.
4. Prefer `fixer` for scoped implementation in build mode.
5. Use `subagent` in normal execution mode, not as a plan-mode escape hatch.

## Context-efficiency rules

1. Prefer `query-docs` over web search for software documentation.
2. Prefer `web_search_exa` over `web_fetch_exa`.
3. Fetch one page at a time unless comparison is necessary.
4. Avoid repeated fetches for the same page unless necessary.
5. Do not call both Context7 and Exa for the same simple question unless the first source is insufficient.
6. Do not reintroduce persisted session-plan files as the primary workflow.
7. Prefer compact handoffs from `explorer`, `librarian`, `fixer`, and `oracle` over copying large raw outputs into the main session.
8. Prefer `questionnaire` over guessing when a short structured question would unblock the task.

## Working on this project

1. Keep tool interfaces simple.
2. Prefer fetch-based integrations over MCP in this repo unless requirements change.
3. Preserve context-efficiency behavior when modifying tools.
4. If adding new tools, return compact previews by default when appropriate.
5. If a change increases output verbosity, justify it and keep the default path compact.
6. Keep the runtime workflow explicit: `Ctrl+\\` for read-only planning, then execute with tracked `[DONE:n]` steps when ready.
7. Keep package docs aligned with the actual tools exported from `extensions/`.
