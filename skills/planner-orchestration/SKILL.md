---
name: planner-orchestration
description: Planner-led retrieval workflow for this package. Use when the main agent should stay in planning mode and delegate only focused explorer or librarian child Pi runs.
---

# Planner Orchestration

Use this skill when the main agent should plan first instead of implementing immediately.

## Core split

- Planner stays in the main session.
- Builder stays in the main session.
- Only `explorer` and `librarian` are child Pi runs.

## Child Pi rule

Use `spawn_pi_subagent` only for focused retrieval tasks:

- `explorer` for local code discovery
- `librarian` for external docs and research

Do not use child Pi runs as general implementation workers.

## Planning workflow

1. Clarify the task only if necessary.
2. Decide whether local discovery, external docs, or both are needed.
3. Spawn only the minimal focused child Pi runs.
4. Consume the compact previews first.
5. Produce a plan the Builder can execute without broad rediscovery.

## Context-efficiency rules

- preview first
- use cache paths when deeper inspection is needed
- avoid duplicate retrieval between planner and builder
- keep child tasks narrow and role-specific
