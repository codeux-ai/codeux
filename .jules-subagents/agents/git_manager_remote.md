# Git Manager Remote Skill (GitHub CLI)

Use when `GitHub Mode = REMOTE`.

## Primary Command Set
- Repository: `gh repo view`
- PR listing: `gh pr list --json ...`
- PR details/comments: `gh pr view <number> --comments`
- PR checks: `gh pr checks <number>`
- CI runs: `gh run list --json ...`
- Merge: `gh pr merge <number> --merge` (or squash/rebase only when explicitly requested)

## Safe Merge Protocol
1. Validate working tree is clean enough for intended operation.
2. Inspect PR comments completely.
3. Add 👀 reactions while reviewing comments.
4. Resolve comments and add ✅ reactions when done.
5. Verify CI checks are green (`gh pr checks` / `gh run list`).
6. Merge only when checks pass.

## CI Guardrail
- If CI checks do not start on `main`, treat this as a potential merge-conflict/sync issue first:
  - inspect PR mergeability (`mergeStateStatus`)
  - verify target branch is up to date
  - check for conflict markers and blocked workflow triggers
