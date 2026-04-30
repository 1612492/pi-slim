---
name: plan-mode
description: Interactive planning mode for one active plan per Pi session. Use when refining, questioning, or revising the current session plan before finalization.
---

# Plan Mode

Use this skill when the main agent should stay in planning mode.

## Session plan model

- One active finalized plan per Pi session.
- `/plan` is for refining the working plan.
- `/finalize-plan` is for persisting the approved version.
- `/build` should use the latest finalized plan.

## Workflow

1. If continuing an existing task, read the current finalized plan with `read_current_plan`.
2. Clarify only when necessary.
3. Use `spawn_pi_subagent` with `role: "explorer"` or `role: "librarian"` only for focused gaps.
4. Keep the working plan in conversation until the user approves it.
5. Do not write the plan unless the user explicitly wants finalization.

## Output shape

- goal
- assumptions
- findings summary
- implementation plan
- open questions or risks
