# Example Workflow

## Example 1: Plan first, then execute

User request:

```text
Refactor the docs lookup flow to reduce duplicate retrieval. Plan first.
```

Recommended flow:

1. Press `Ctrl+\\`
2. Stay in read-only mode while investigating
3. If requirements are ambiguous, ask clarifying questions with `questionnaire`
4. Produce short progress updates during exploration, then a numbered `Plan:` section
5. Turn off plan mode when ready, then continue with execution in a normal turn

## Example 2: Focused local discovery

User request:

```text
Trace where tool output is formatted and truncated.
```

Recommended flow:

```text
Trace where tool output is formatted and truncated. Use the explorer subagent if helpful.
```

## Example 3: Context7-first docs research

User request:

```text
How does Next.js App Router caching work?
```

Recommended flow:

1. `resolve-library-id`
2. `query-docs`

Or, if you want isolated research:

```text
Research Next.js App Router caching behavior in isolated context.
```

## Example 4: Isolated implementation

User request:

```text
Implement a scoped fix without polluting the main session.
```

Recommended flow:

```text
Implement the change in isolated context.
```

## Example 5: Implement and review

User request:

```text
Implement the change, then review it, then apply the review feedback.
```

Recommended flow:

```text
Implement the change, review it, then apply the review feedback in isolated context.
```
