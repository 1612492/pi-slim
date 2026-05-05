---
name: librarian-research
description: External documentation and web research discipline for the librarian subagent. Use when Context7 or Exa is needed without editing code.
---

# Librarian Research

Use this skill when creating or interpreting a `librarian` subagent run.

## Default source order

1. `resolve-library-id`
2. `query-docs`
3. `web_search_exa`
4. `web_fetch_exa`

## Rules

- Prefer Context7 for software docs.
- Use Exa for broader web research or when Context7 is insufficient.
- Fetch one page at a time unless comparison is necessary.
- Keep the result compact and source-aware.
- Do not edit files.

## Output shape

- short answer
- key findings
- source or URL references when relevant
- remaining uncertainty
