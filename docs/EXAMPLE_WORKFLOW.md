# Example Workflow

This package uses a planner-led workflow:

- `Planner` stays in the main agent
- `Builder` stays in the main agent
- only `Explorer` and `Librarian` are child Pi runs

## 1. Planning

User:

```text
/plan Add a new docs lookup flow that avoids duplicate retrieval.
```

Main agent behavior:

1. Understand the task.
2. Decide whether local discovery is needed.
3. Decide whether external docs research is needed.
4. Spawn focused child Pi runs only if useful:
   - `spawn_pi_subagent` with `role: "explorer"`
   - `spawn_pi_subagent` with `role: "librarian"`
5. Produce a compact working plan in conversation.
6. Do not persist the canonical plan yet.

Example child run for local discovery:

```text
Use spawn_pi_subagent with role explorer to trace where docs lookup is implemented and where cache paths are returned.
```

Example child run for docs research:

```text
Use spawn_pi_subagent with role librarian to check current Context7 best practices for resolving library IDs before docs queries.
```

Planner output should include:

- goal
- assumptions
- findings summary
- implementation steps
- risks or open questions

## 2. Finalizing

User:

```text
/finalize-plan
```

Main agent behavior:

1. Clean up the approved working plan.
2. Call `write_plan`.
3. Persist:
   - `current-plan.md`
   - `<task-slug>-vN.md`
4. Return the saved paths.

## 3. Building

User:

```text
/build Implement the approved plan.
```

Main agent behavior:

1. Call `read_current_plan` first.
2. Implement using narrowed context.
3. Avoid broad rediscovery.
4. If a small gap appears, use one narrow child run:
   - `explorer` for local code lookup
   - `librarian` for docs lookup
5. If broad new research is needed, return to planning instead of drifting.

## 4. Example end-to-end flow

```text
/plan Refactor the research tools so planner owns retrieval routing.
```

Possible planning sequence:

1. Main agent spawns `explorer` to inspect current extension structure.
2. Main agent spawns `librarian` to confirm docs/research tool usage rules.
3. Main agent drafts a plan.

Then:

```text
/finalize-plan
```

Then:

```text
/build Implement the planner-led routing changes from the plan.
```

Possible build sequence:

1. Main agent edits files directly.
2. Main agent runs tests.
3. If one symbol location is unclear, it spawns `explorer` once.
4. If one API detail is unclear, it spawns `librarian` once.
5. If the build is interrupted, return to `/plan`, revise, `/finalize-plan`, then `/build` again.

## 5. Rules of thumb

- Use `/plan` before non-trivial changes.
- Use `/finalize-plan` when the plan is approved.
- Use `/build` after the plan is finalized.
- Keep `Planner` and `Builder` in the main session.
- Keep one active finalized plan per Pi session.
- Use child Pi runs only for focused retrieval.
- Prefer compact previews and cache paths over large pasted outputs.
- Avoid parallel implementation workers.

## 6. Minimal direct tool examples

List available child roles:

```text
Use spawn_pi_subagent with action list.
```

Run explorer directly:

```text
Use spawn_pi_subagent with role explorer to find where query-docs is called and summarize the relevant files.
```

Run librarian directly:

```text
Use spawn_pi_subagent with role librarian to look up current Pi package prompt template conventions.
```

Read the current finalized session plan:

```text
Use read_current_plan.
```

Write the approved plan manually:

```text
Use write_plan with the cleaned final plan sections.
```
