---
name: plan-mode
description: Runtime planning discipline for read-only exploration with `/plan`, extracted plan steps, and tracked execution.
---

# Plan Mode

Use this skill when the main session should stay in read-only planning mode.

## Runtime model

- `/plan` toggles read-only planning mode.
- The agent should produce a numbered `Plan:` section.
- Plan mode blocks editing and unsafe shell commands.
- When the user executes the plan, the agent should mark completed steps with `[DONE:n]`.

## Rules

- Do not edit files while plan mode is active.
- Prefer the smallest read-only tool that can answer the question.
- Use research tools normally if they are needed and remain read-only.
- Keep the plan concrete, ordered, and implementation-ready.

## Output shape

```text
Plan:
1. First concrete step
2. Second concrete step
3. ...
```
