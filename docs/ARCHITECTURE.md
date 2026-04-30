# Architecture

## Goal

Optimize for context efficiency by making planning the default entry point for retrieval, keeping execution focused, and storing large outputs outside the main conversation flow.

## Recommended flow

```text
Planner
  ├─ drafts/revises working plan in conversation
  ├─ finalizes current-plan.md + plan-vN.md
  ├─ calls Explorer for local code discovery
  └─ calls Librarian for external docs/research

Explorer
  ├─ glob / grep / rg / find-like search
  └─ ast-grep

Librarian
  ├─ Context7 for library/framework docs
  ├─ Exa for general web research
  └─ grep.app for real-world code examples

Explorer/Librarian outputs
  ├─ compact preview for immediate use
  └─ cached tool file for full results

Builder
  ├─ reads current-plan.md for this session
  ├─ consumes plan + previews + cache references
  └─ performs implementation
```

## Session plan lifecycle

One active plan exists per Pi session.

```text
/plan
  └─ refine working plan in conversation

/finalize-plan
  ├─ write <task-slug>-vN.md
  └─ update current-plan.md

/build
  └─ read current-plan.md and implement from it
```

If build is interrupted, the user can return to `/plan`, revise the plan, `/finalize-plan` again, then `/build` continues from the newer finalized plan.

## Core rule

`Builder` should usually take a plan from `Planner` instead of calling `Explorer` and `Librarian` directly.

This is more context-efficient because it:

- avoids duplicate searches
- avoids duplicate external lookups
- keeps `Builder` focused on execution
- makes caching and reuse simpler
- reduces unnecessary context expansion

## Why not make Builder fully dependent on Planner?

A strict ban on direct `Builder` lookups is too rigid.

During implementation, `Builder` may discover:

- a missing symbol
- an unclear file location
- a docs gap
- an edge case that needs one small follow-up query

In those cases, a narrow direct lookup can be cheaper than sending control back through full replanning.

## Recommended policy

### Default behavior

1. `Planner` decides what information is needed.
2. If this session already has a finalized plan, `Planner` can read it and revise from that baseline.
3. `Planner` calls `Explorer` and/or `Librarian`.
4. They return:
   - a small preview
   - a cache path or tool file reference
5. `/finalize-plan` writes the approved canonical plan for this session.
6. `Builder` receives the plan plus those references.
7. `Builder` implements using that narrowed context.

### Exception behavior

`Builder` may call retrieval tools directly only for small follow-up queries.

Examples:

- resolve one symbol
- check one nearby file
- verify one API detail

### Escalation rule

If `Builder` needs a broad search, multiple lookups, or new research scope, route back through `Planner`.

## Retrieval boundaries

### Planner

- owns orchestration
- decides whether local search or external research is needed
- prevents redundant retrieval
- revises the session plan
- finalizes the canonical plan only when explicitly asked

### Explorer

- handles local codebase discovery
- returns minimal summaries first
- stores full outputs in tool files

### Librarian

- handles external docs and research
- prefers Context7 for normal software docs
- uses Exa for broader web research
- uses grep.app for real-world code examples
- returns minimal summaries first

### Builder

- should consume planned context first
- should read the latest finalized session plan first
- should avoid broad rediscovery
- may perform narrow corrective lookup when cheaper than replanning

## Context-efficiency principles

- preview first, full result on demand
- cache every large tool output
- keep one active finalized plan per session
- pass references, not large payloads
- avoid repeated fetches for the same question
- prefer one orchestrated retrieval path by default
- let execution use narrowed context, not raw search output

## Anti-patterns

Avoid these patterns:

- `Planner` and `Builder` both running the same searches
- `Builder` doing broad discovery by default
- implementing without a finalized plan when the workflow expects one
- always loading full tool files into context
- using external search before targeted docs lookup when docs are enough
- creating many isolated tool files without preview/reference discipline

## Summary

Best design:

- `Planner` is the default retrieval orchestrator.
- One active finalized plan exists per Pi session.
- `/finalize-plan` writes `current-plan.md` plus a meaningful task-based versioned snapshot.
- `Builder` consumes the plan and cached references.
- `Builder` can do limited direct lookup only as an exception.

This gives better context efficiency than letting `Builder` independently call `Explorer` and `Librarian` for normal work.
