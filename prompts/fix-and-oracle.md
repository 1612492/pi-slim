---
description: Fixer implements, oracle reviews, fixer applies the feedback.
---

Use the `subagent` tool with the `chain` parameter to execute this workflow:

1. First, use the `fixer` agent to implement: $@
2. Then, use the `oracle` agent to review the implementation from the previous step using `{previous}`
3. Finally, use the `fixer` agent to apply the oracle feedback using `{previous}`

Execute this as a chain and return the final fixer result.
