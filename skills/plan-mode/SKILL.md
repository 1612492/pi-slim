---
name: plan-mode
description: Runtime planning discipline for read-only exploration with `Ctrl+\\`, extracted plan steps, and tracked execution.
---

# Plan Mode

Use this skill when the main session should stay in read-only planning mode.

## Runtime model

- `Ctrl+\\` toggles read-only planning mode.
- The agent should show short progress updates while exploring.
- The agent should produce a numbered `Plan:` section.
- Plan mode blocks editing and unsafe shell commands.
- Plan mode may use `subagent` only for bounded read-only delegation.
- The plan is returned in the normal assistant response with no extra todo list message.

## Rules

- Do not edit files while plan mode is active.
- Prefer the smallest read-only tool that can answer the question.
- If requirements are ambiguous, ask clarifying questions with `questionnaire`.
- Use `explorer`, `librarian`, and `oracle` for read-only delegated work.
- Use `fixer` for build-mode implementation, not plan mode.
- Use research tools normally if they are needed and remain read-only.
- Keep the plan concrete, ordered, and implementation-ready.

## Output shape

```text
I’m inspecting the target area and nearby examples so the plan matches the repo’s existing style.
I found the main implementation path; now I’m checking the closest tests and helper utilities to keep the plan minimal.

Plan:
1. First concrete step
2. Second concrete step
3. ...
```
