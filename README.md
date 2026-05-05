# pi-slim

Minimal Pi package focused on context-efficient docs lookup, runtime plan mode, and delegated subagents.

## What it provides

### Tools

- `resolve-library-id`
- `query-docs`
- `web_search_exa`
- `web_fetch_exa`
- `subagent`

### Runtime workflow

- `/plan` toggles read-only planning mode
- numbered `Plan:` sections are extracted into tracked todos
- execution mode tracks step completion with `[DONE:n]`

### Repo-owned subagents

- `explorer` - focused local code discovery
- `librarian` - Context7-first docs and research
- `fixer` - isolated implementation
- `oracle` - review, risk analysis, and simplification guidance

### Prompt templates

- `/explore`
- `/research`
- `/fix`
- `/oracle`
- `/fix-and-oracle`

## Design goals

1. Prefer the smallest tool that can answer the question.
2. Prefer Context7 before web search for normal library docs.
3. Keep planning read-only until execution is explicitly chosen.
4. Use isolated subagents for bounded recon, implementation, and review.
5. Keep outputs compact and handoff-friendly.

## Plan mode

Plan mode is runtime state, not a persisted plan file workflow.

- `/plan` enables read-only exploration.
- Only read-only tools remain active.
- Unsafe bash commands are blocked.
- The agent should respond with a numbered `Plan:` section.
- After planning, the UI can switch into execution mode.
- During execution, the agent marks completed steps with `[DONE:n]`.

## Subagent tool

`subagent` supports three modes:

- single: `{ agent, task }`
- parallel: `{ tasks: [...] }`
- chain: `{ chain: [...] }`

Default scope is project agents from `agents/`.

## Research tools

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

## Installation

```bash
pnpm install
pnpm test
```

## Configuration

Environment variables:

- `CONTEXT7_API_KEY`
- `EXA_API_KEY`

## Package layout

```text
agents/
  explorer.md
  librarian.md
  fixer.md
  oracle.md
extensions/
  index.ts
  plan-mode/
    index.ts
    utils.ts
  subagent/
    index.ts
    agents.ts
  tools/
    context7.ts
    exa.ts
prompts/
  explore.md
  research.md
  fix.md
  oracle.md
  fix-and-oracle.md
skills/
  explorer-recon/
  librarian-research/
  fixer-execution/
  oracle-review/
  plan-mode/
  research-tools/
```

## Example usage

```text
/plan
```

```text
Use subagent with agent explorer to trace where tool output is formatted and truncated.
```

```text
Use subagent with a fixer -> oracle -> fixer chain to implement and review a change.
```
