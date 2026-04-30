---
description: Finalize the current session plan. Summarize the approved working plan, write it with write_plan, and return the saved current-plan and versioned snapshot paths.
---

Finalize the current session plan.

Default behavior:

1. Use the current planning context from the conversation.
2. If needed, call `read_current_plan` to compare against the previous finalized version.
3. Produce a clean final plan with these sections:
   - Goal
   - Assumptions
   - Findings Summary
   - Implementation Plan
   - Risks / Open Questions
4. Call `write_plan` to persist the approved plan for this session.
5. Return the saved paths and a brief summary of what changed.

Rules:

- This is the only workflow step that should write the canonical session plan.
- One active plan exists per Pi session.
- Finalization should create a new versioned snapshot and update `current-plan.md`.
- Do not start implementation in this step.
