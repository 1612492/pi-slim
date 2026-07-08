# pi-slim

Minimal Pi package focused on context-efficient docs lookup, structured clarification, runtime plan mode, and delegated subagents.

## What it provides

### Tools

- `resolve-library-id`
- `query-docs`
- `web_search_exa`
- `web_fetch_exa`
- `lsp_hover`
- `lsp_definition`
- `lsp_declaration`
- `lsp_type_definition`
- `lsp_implementation`
- `lsp_references`
- `lsp_diagnostics` (requires `filePath`)
- `subagent`
- `questionnaire`

### Runtime workflow

- `Ctrl+\\` toggles read-only planning mode
- OpenCode-style progress updates can precede the numbered `Plan:` section
- the plan is returned in the normal assistant response
- ambiguous planning questions can use `questionnaire`
- plan mode may delegate bounded read-only work to `explorer`, `librarian`, or `oracle`
- plan mode stays read-only and should not be bypassed via `subagent`

### Repo-owned subagents

- `explorer` - focused local code discovery with LSP-assisted TypeScript navigation
- `librarian` - Context7-first docs and research
- `oracle` - review, risk analysis, and simplification guidance with LSP-assisted TS inspection
- `fixer` - isolated implementation in build mode with optional LSP-assisted TS verification

## Design goals

1. Prefer the smallest tool that can answer the question.
2. Prefer Context7 before web search for normal library docs.
3. Keep planning read-only until execution is explicitly chosen.
4. Use isolated subagents for bounded recon, implementation, and review.
5. Keep outputs compact and handoff-friendly.
6. Prefer structured clarification over guessing when a short question will do.

## Plan mode

Plan mode is runtime state, not a persisted plan file workflow.

- `Ctrl+\\` enables read-only exploration.
- Only a restricted read-only-safe tool set remains active.
- Unsafe bash commands are blocked.
- If requirements are ambiguous, plan mode can ask structured clarifying questions with `questionnaire`.
- Plan mode can use `subagent` only for bounded read-only delegation.
- The agent should respond with brief progress narration followed by a numbered `Plan:` section.
- `subagent` should not be used to bypass plan-mode restrictions.

## Subagent tool

`subagent` supports three modes:

- single: `{ agent, task }`
- parallel: `{ tasks: [...] }`
- chain: `{ chain: [...] }`

Additional behavior:

- default `agentScope` is `builtin`
- built-in agents are discovered from this package's `agents/` directory, regardless of target cwd
- `agentScope` can be `builtin`, `user`, or `both`
- user agents from `~/.pi/agent/agents` can override built-ins by name

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

Install this package in Pi:

```bash
pi install git:github.com/1612492/pi-slim
```

For local development:

```bash
pnpm install
pnpm test
```

## Configuration

Environment variables:

- `CONTEXT7_API_KEY`
- `EXA_API_KEY`

LSP tools use the package-installed `typescript-language-server` dependency.
Install with `pnpm install`; the extension resolves the local binary from
`node_modules` and does not rely on global `PATH` lookup.

## Themes

This package ships a bundled theme: `catppuccin-mocha`.

Select it in `~/.pi/agent/settings.json`:

```json
{
  "theme": "catppuccin-mocha"
}
```

The theme source file is available at `themes/catppuccin-mocha.json`.

## Package layout

```text
agents/
  explorer.md
  librarian.md
  fixer.md
  oracle.md
extensions/
  index.ts
  context7/
    index.ts
    index.test.ts
  exa/
    index.ts
    index.test.ts
  lsp/
    index.ts
    index.test.ts
  permission-gate/
    index.ts
  plan-mode/
    index.ts
    utils.ts
  subagent/
    index.ts
    utils.ts
  questionnaire/
    index.ts
    index.test.ts
skills/
  explorer/
  librarian/
  fixer/
  oracle/
  plan-mode/
  research-tools/
```

## Example usage

```text
Trace where tool output is formatted and truncated. Use the explorer subagent if helpful.
```

```text
Research Next.js App Router caching behavior in isolated context.
```

```text
Implement the change, review it, then apply the review feedback in isolated context.
```
