# pi-slim

Minimal Pi package focused on context-efficient docs lookup and web research.

## What it provides

### Tools

- `resolve-library-id`
- `query-docs`
- `web_search_exa`
- `web_fetch_exa`
- `spawn_pi_subagent`
- `write_plan`
- `read_current_plan`

### Skill

- `research-tools`
- `planner-orchestration`
- `explorer-recon`
- `librarian-research`
- `plan-mode`
- `build-from-plan`

The skill guides Pi toward using the smallest tool possible and avoiding unnecessary context growth.

### Prompt templates

- `/plan`
- `/finalize-plan`
- `/build`

## Design goals

1. Keep tool interfaces simple.
2. Prefer official docs lookup for libraries and frameworks.
3. Prefer search before fetch for web research.
4. Save full tool output to cache and return compact previews.
5. Keep the agent context small unless deeper inspection is actually needed.
6. Keep planning and building in the main agent; use child Pi runs only for focused explorer/librarian tasks.

## Tool usage model

### Context7

Use for library, framework, and SDK documentation.

Order:

1. `resolve-library-id`
2. `query-docs`

### Exa

Use for general web research and external pages.

Order:

1. `web_search_exa`
2. `web_fetch_exa`

### Child Pi subagents

Use `spawn_pi_subagent` for focused retrieval only.

Available child roles:

- `explorer` for local code discovery
- `librarian` for external docs and research

Keep `Planner` and `Builder` in the main session, typically via `/plan` and `/build`.

### Session plan workflow

Use one active plan per Pi session.

- `/plan` refines the working plan in conversation.
- `/finalize-plan` writes the approved plan to the persistent `plans/` cache.
- `/build` reads the latest finalized plan for the current session before implementing.

## Cache behavior

Full tool outputs are written to a session-scoped cache under:

```text
$HOME/.cache/pi/tools/<session-dir>/<session-file-stem>/...
```

Planned persistent plan outputs belong under:

```text
$HOME/.cache/pi/plans/<session-dir>/<session-file-stem>/...
```

Notes:

- tool responses return a compact preview plus a cache file path
- tool cache is cleared on session shutdown
- plan cache is intended to persist
- finalized plans are versioned with a task-based filename like `refactor-docs-lookup-v2.md` and mirrored to `current-plan.md`

Example tool cache path:

```text
/Users/name/.cache/pi/tools/--Users-name-project--/2026-04-30T15-42-32-577Z_<session-id>/web_fetch_exa-....txt
```

## Installation

Install dependencies:

```bash
pnpm install
```

Run tests:

```bash
pnpm test
```

## Configuration

Environment variables:

- `CONTEXT7_API_KEY`
- `EXA_API_KEY`

## Package layout

```text
extensions/
  index.ts
  tools/
    agents.ts
    cache.ts
    child-pi.ts
    context7.ts
    exa.ts
    plan.ts
    subagent.ts
agents/
  explorer.md
  librarian.md
prompts/
  plan.md
  finalize-plan.md
  build.md
skills/
  build-from-plan/
    SKILL.md
  planner-orchestration/
    SKILL.md
  plan-mode/
    SKILL.md
  explorer-recon/
    SKILL.md
  librarian-research/
    SKILL.md
  research-tools/
    SKILL.md
AGENTS.md
README.md
```

## Example prompts

Load the skill explicitly:

```text
/skill:research-tools
```

Library docs lookup:

```text
Use resolve-library-id and query-docs to look up Next.js App Router caching behavior.
```

Web research:

```text
Search the web for Pi skills documentation.
```

Fetch a known page:

```text
Use web_fetch_exa to fetch https://exa.ai/docs/reference/contents-retrieval.
```

Planner mode:

```text
/plan Refactor the docs lookup flow to reduce duplicate retrieval.
```

Finalize the plan:

```text
/finalize-plan
```

Builder mode:

```text
/build Implement the approved plan using the existing plan context first.
```

Focused child Pi run:

```text
Use spawn_pi_subagent with role explorer to trace where cache paths are produced.
```

## Context-efficiency guidance

1. Prefer `query-docs` over web search for software docs.
2. Prefer `web_search_exa` over `web_fetch_exa`.
3. Read cached files only when the preview is insufficient.
4. Read smaller slices instead of full cached files when possible.
