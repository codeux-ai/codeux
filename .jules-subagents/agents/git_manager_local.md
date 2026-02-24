# Git Manager Local Skill (Git Commands)

Use when `GitHub Mode = LOCAL`.

## Primary Command Set
- Status: `git status --short`, `git branch --show-current`
- Sync: `git fetch`, `git pull`
- Branching: `git checkout -b <branch>`
- Commit: `git add -A && git commit -m \"...\"`
- Merge: `git merge <branch>`

## Local Safety Protocol
1. Check repository health before each operation.
2. Resolve conflicts locally before any integration step.
3. Never perform destructive operations without explicit confirmation.
4. Keep operation logs concise and explicit.

## Notes
- No remote PR/CI operations are assumed in local mode.
- Remote-specific workflows (PR comments/reactions/merge via `gh`) are disabled.
