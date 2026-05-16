# AGENTS.md

This is the common AI instruction file for Codex, Claude, and other coding
agents working in this repository.

The detailed legacy project specification is retained in `CODEX.md`. Read it
before any business, API, deployment, or authentication change. Keep V1
read-only unless the user explicitly requests a separate V2 editing scope.

# AI Coding Rules

## Operating Principles

- Before editing, restate the task goal, success criteria, and files likely to change.
- Prefer the smallest correct change. Do not refactor unrelated code.
- Match existing project patterns even if another approach seems cleaner.
- Do not silently assume missing requirements. Ask or state the assumption clearly.
- If two existing conventions conflict, stop and ask which one to follow.
- Stop after each major step and summarize changed files, reasoning, and verification.
- Tests passing is not enough; explain what behavior was actually verified.
- Surface failures loudly. Do not hide skipped records, swallowed errors, partial success, or uncertain results.

## Task Discipline

For every non-trivial task, first write:

- Goal:
- Non-goals:
- Files likely to change:
- Success criteria:
- Verification plan:

Do not expand scope unless explicitly asked.

## Editing Rules

- Make surgical changes.
- Preserve user changes and unrelated code.
- Do not rename, reorganize, or reformat unrelated files.
- Reuse existing helpers, patterns, and conventions before adding new abstractions.
- Add comments only when they explain non-obvious logic.

## Verification

Before calling the task complete:

- Run the most relevant tests or checks available.
- If tests cannot be run, explain why.
- Summarize what was verified manually.
- List any remaining risks or assumptions.
