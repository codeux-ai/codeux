# Git Manager Remote Skill (GitHub CLI)

Use when `GitHub Mode = REMOTE`.

## Primary Command Set
- Repository: `gh repo view`
- PR listing: `gh pr list --json ...`
- PR details/comments: `gh pr view <number> --comments`
- Inline review comments/code suggestions: `gh api repos/<owner>/<repo>/pulls/<number>/comments`
- PR checks: `gh pr checks <number> --watch`
- CI runs: `gh run list --json ...`
- CI run watch: `gh run watch <run-id>`
- Merge: `gh pr merge <number> --merge` (or squash/rebase only when explicitly requested)

## Safe Merge Protocol
1. Validate working tree is clean enough for intended operation.
2. Inspect PR comments completely (both `gh pr view --comments` and inline `pulls/<number>/comments`).
3. Add 👀 reactions while reviewing comments.
4. Implement requested fixes.
5. Reply on addressed inline comments with resolution notes and add ✅ reactions when done.
6. Verify CI checks are green (`gh pr checks <number> --watch`; use `gh run watch <run-id>` when needed).
7. Merge only when checks pass.

## CI Guardrail
- If CI checks do not start on `main`, treat this as a potential merge-conflict/sync issue first:
  - inspect PR mergeability (`mergeStateStatus`)
  - verify target branch is up to date
  - check for conflict markers and blocked workflow triggers
