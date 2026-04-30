---
name: build-from-plan
description: Implement from the current session's finalized plan. Use when the main agent should read the canonical plan first, then build with minimal rediscovery.
---

# Build From Plan

Use this skill when implementing a finalized session plan.

## Workflow

1. Read the current finalized plan with `read_current_plan`.
2. If no finalized plan exists, ask whether to go back to planning first.
3. Implement from the plan and current worktree state.
4. Use `spawn_pi_subagent` only for narrow follow-up retrieval.
5. If the plan needs a major change, return to planning instead of drifting.

## Rules

- builder stays in the main session
- explorer and librarian stay focused
- avoid broad rediscovery
- prefer plan-driven execution over improvisation
