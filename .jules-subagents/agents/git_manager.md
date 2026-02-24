# Git Manager Skill

Purpose: provide a safe, deterministic connector for git operations in this MCP.

## Core Rules
- Never run destructive git commands (`reset --hard`, `checkout --`, force push) unless explicitly requested.
- Always validate repository state before operations:
  - `git rev-parse --is-inside-work-tree`
  - `git status --short`
  - `git branch --show-current`
- Enforce CI-first merge discipline:
  - never merge if required checks are failing or pending.
  - always watch checks live before merge (`gh pr checks <number> --watch` in remote mode).
  - if CI checks do not start on `main` after merge, inspect merge conflicts immediately.
- Keep auditability:
  - report each merge/PR/status action with command + result summary.
- For PR review workflow:
  - read all PR comments before merge.
  - always fetch both comment streams:
    - issue-style PR comments (`gh pr view <number> --comments`)
    - inline review/code comments (`gh api repos/<owner>/<repo>/pulls/<number>/comments`)
  - add 👀 reaction to comments currently being reviewed.
  - after implementing fixes, reply on each addressed inline comment with a resolution note and add ✅ reaction.

## Skillset Routing
- Use `git_manager_remote` when GitHub mode is `REMOTE`.
- Use `git_manager_local` when GitHub mode is `LOCAL`.
- Exactly one mode-specific skill is active at a time.
