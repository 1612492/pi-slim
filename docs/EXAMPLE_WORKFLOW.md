# Example Workflow

## Example 1: Plan first, then execute

User request:

```text
Refactor the docs lookup flow to reduce duplicate retrieval. Plan first.
```

Recommended flow:

1. Run `/plan`
2. Stay in read-only mode while investigating
3. Produce a numbered `Plan:` section
4. Choose `Execute the plan`
5. Mark progress with `[DONE:n]`

## Example 2: Focused local discovery

User request:

```text
Trace where tool cache paths are produced.
```

Recommended flow:

```text
Use subagent with agent explorer to trace where tool cache paths are produced.
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
Use subagent with agent librarian to research Next.js App Router caching behavior.
```

## Example 4: Isolated implementation

User request:

```text
Implement a scoped fix without polluting the main session.
```

Recommended flow:

```text
Use subagent with agent fixer to implement the change.
```

## Example 5: Implement and review

User request:

```text
Implement the change, then review it, then apply the review feedback.
```

Recommended flow:

```text
Use subagent with a fixer -> oracle -> fixer chain.
```
