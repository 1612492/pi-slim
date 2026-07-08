Review the current changes and write a commit message that matches this repository's existing convention.

Instructions:
- Inspect recent commit subjects first and infer the convention actually used in this repo.
- Prefer the dominant observed style instead of inventing a new one.
- Then inspect the current diff and summarize the change accurately.
- Match the repo's tone, casing, and prefix pattern.
- Keep the message concise and specific.
- Return a single commit subject line only.
- Do not include explanation, bullets, quotes, or code fences.

Heuristics:
- Reuse existing commit types seen in history when possible.
- If multiple types seem plausible, choose the one that best reflects the primary user-visible impact.
- If the change is small or internal, prefer the closest lightweight type already used by the repo.
