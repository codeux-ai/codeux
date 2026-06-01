---
name: ci-debugging-by-investigating-workflow-and-diff
description: Debug a CI failure by first inspecting the workflow config, reproducing failures locally, analyzing git changes, applying a surgical fix, and re-verifying all quality gates
source: auto-skill
extracted_at: '2026-05-31T23:12:36.762Z'
---

# Procedure: CI Failure Debugging

Use this when a CI check fails and the error message is ambiguous or points to a missing/invalid dependency, path, or configuration — not a code logic failure.

## 1. Establish current state
```bash
git branch --show-current       # confirm you're on the right branch
git log --oneline -5            # see recent commits
git status                      # check for dirty/uncommitted files
git diff HEAD~1 --stat          # see what files changed in the last commit
```

## 2. Read the CI workflow
Find `.github/workflows/*.yml` and read the failing job's steps. Look for:
- **Step-level errors**: `Some specified paths were not resolved` means a path referenced in `cache-dependency-path` or similar doesn't exist.
- **Command failures**: `pnpm install --frozen-lockfile` failing after a commit that deleted `pnpm-lock.yaml`.
- **Tool installation**: Missing runtime (Docker, etc.) — but only if the step that installs/setups the tool fails, not the test that uses it.

## 3. Cross-reference git changes with the workflow
If a file was deleted (shown in `git diff HEAD~1 --stat` or `git show HEAD -- <file>` returning nothing), check whether the CI workflow references that file path. Common paths that break CI:
- Lockfiles (`pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`) — especially when the `packageManager` field in `package.json` differs.
- Config files referenced in `cache-dependency-path`.
- Any explicitly listed path in `actions/cache@v4` `path:` or `key:`.

## 4. Verify the file's existence and hash
```bash
# Check if the file is tracked at all
git show HEAD -- <suspected-file>

# Compare hash with parent commit to confirm correct restoration
git hash-object <restored-file>
git show HEAD~1:<original-path> | git hash-object --stdin
# Both hashes must match.
```

## 5. Restore the file from git history
When a file was accidentally deleted in the most recent commit:
```bash
git show HEAD~1:<path-to-deleted-file> > <path-to-deleted-file>
```
Do **not** run `git checkout HEAD~1 -- <path>` — that rewrites the index for the entire file and may bring unintended content.

## 6. Reproduce all quality gates (not just the failing step)
Run the full CI command chain, each step individually if the chain uses `&&`:
```bash
npm run lint          # or tsc --noEmit
npm run typecheck     # if separate from lint
npm run test          # or the specific test suite that CI runs
npm run build         # tsc + bundler
```
If a step fails, it is the **only** failure to fix — stop and investigate it. If a failing test is pre-existing (e.g. Docker-dependent tests in a non-Docker environment), confirm it passes in CI by inspecting its dependencies.

## 7. Commit with a descriptive message
```bash
git add <restored-file>
git commit -m "fix(ci): <what was wrong and why>

<one-line summary of the error>
<one-line summary of the root cause>
<one-line summary of the fix>"
```

Do **not** rewrite history, squash, or open a new PR. The branch must remain in a pushable state with the fix as an incremental commit.