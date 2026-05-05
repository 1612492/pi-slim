# Architecture

## Goal

Optimize for context efficiency with a runtime planning mode and isolated specialist subagents.

## Recommended flow

```text
Main Session
  ├─ /plan enables read-only planning
  ├─ drafts a numbered Plan:
  ├─ executes with [DONE:n] tracking when approved
  ├─ calls Explorer for local code discovery when needed
  ├─ calls Librarian for docs/research when needed
  ├─ calls Fixer for isolated implementation when needed
  └─ calls Oracle for review or strategic guidance when needed

Explorer
  └─ local search + targeted file reads

Librarian
  └─ Context7-first docs + Exa research

Fixer
  └─ scoped implementation in isolated context

Oracle
  └─ review, risk analysis, and simplification guidance
```

## Plan mode lifecycle

Plan mode is runtime state, not a persisted file workflow.

```text
/plan
  ├─ enables read-only planning
  ├─ restricts tools
  ├─ blocks unsafe bash commands
  └─ asks the agent for a numbered Plan:

execute plan
  ├─ restores full tool access
  └─ tracks completion with [DONE:n]
```

## Subagent roles

### Explorer

- local discovery only
- compact file-and-symbol handoff

### Librarian

- Context7 first for software docs
- Exa only when needed
- source-grounded conclusions

### Fixer

- bounded implementation work
- concise files-changed and verification notes

### Oracle

- review and risk analysis
- tradeoff and simplification guidance
- read-only inspection only

## Context-efficiency principles

- prefer read-only planning before execution
- prefer the smallest retrieval path that answers the question
- prefer compact handoffs over raw output dumps
- prefer isolated implementation or review when it reduces main-session context growth
- prefer Context7 before web search for library docs

## Anti-patterns

- reintroducing persisted `current-plan.md` workflow
- using `fixer` or `subagent` during plan mode to bypass read-only restrictions
- broad rediscovery when a focused subagent handoff is enough
- using web search first for ordinary software docs questions
