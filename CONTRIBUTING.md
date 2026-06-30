# Contributing to Code UX

Thanks for your interest in improving **Code UX** (`@codeuxai/codeux`) — the local-first,
container-first agentic coding runtime. This guide covers how to set up, make changes, and get them
merged.

By participating you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report bugs** and **request features** through [GitHub Issues](https://github.com/codeux-ai/codeux/issues)
  (please use the templates).
- **Improve documentation** under `docs/` — the source of truth (entrypoint `docs/index.md`, index
  `docs/SUMMARY.md`).
- **Fix bugs or build features** via pull requests.
- **Report security vulnerabilities** privately — see [SECURITY.md](./SECURITY.md). Do **not** open a
  public issue for these.

## Prerequisites

- **Node.js 22+**
- **pnpm `10.33.0`** (the repo pins `packageManager`; use `pnpm`, not `npm`)
- **Docker** — provider CLIs execute in short-lived Docker workspaces

## Local setup

```bash
git clone https://github.com/codeux-ai/codeux.git
cd codeux
pnpm install
pnpm run dev          # run the server from source; dashboard at http://localhost:4444
```

Most provider and credential configuration is done **from the dashboard** and stored in SQLite at
`~/.code-ux/app.db` — Code UX can start with no keys. Only the hosted Jules provider needs an env var
(`JULES_API_KEY`).

## Branching & workflow

- **`dev` is the integration branch.** Branch off `dev` and open pull requests **into `dev`** — never
  commit directly to `dev` or `main`, and don't target `main`.
- Use descriptive branch names: `feat/<scope>`, `fix/<scope>`, `docs/<scope>`, `chore/<scope>`.
- Keep PRs small and focused (target under ~400 changed lines, excluding generated files).
- Use the GitHub CLI where convenient: `gh pr create --base dev`.

## Coding standards

- **TypeScript throughout** (ESM, `NodeNext`). Imports use `.js` extensions even for `.ts` sources.
  No new plain-JS modules.
- Strict typing — avoid `any`; add explicit return types on exported functions and public APIs.
- 2-space indentation. `camelCase` for variables/functions, `PascalCase` for types/components,
  `SCREAMING_SNAKE_CASE` for env-like constants.
- Shared domain types live in `src/contracts/`.
- **Tailwind is the only styling approach** for the dashboard — don't add UI frameworks or new runtime
  dependencies without discussion.

## Testing & validation

Every functional change must include or update tests. Before opening a PR, run at minimum:

```bash
pnpm run lint            # tsc --noEmit (strict)
pnpm run test:backend    # backend suites (add test:dashboard for UI changes)
pnpm run build
```

`pnpm run ci` runs the full local equivalent (lint → backend coverage → dashboard tests → build →
audit). Coverage thresholds are **ratchet-only — never lower them**.

- Vitest with `vi.mock()` / `vi.spyOn()`. Default env is Node; UI tests opt into jsdom via
  `@vitest-environment jsdom`.
- Tests use an in-memory DB (`VITEST_IN_MEMORY_DB=true`). Mock external boundaries (provider CLIs,
  Docker, FS, Jules API).
- For dashboard changes, also verify the UI loads at `http://localhost:4444`.

## Commits

Follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`,
`chore:`, `style:`, `refactor:`, `test:`. Keep commits scoped to one change with imperative,
concise summaries.

## Documentation

If you change behavior, update the affected page under `docs/`. New subsystems get a new page linked
from `docs/index.md` and `docs/SUMMARY.md`.

## Pull request checklist

- [ ] Branched off `dev`, targeting `dev`
- [ ] `pnpm run lint`, `pnpm run test:backend` (+ `test:dashboard` for UI), and `pnpm run build` pass
- [ ] Tests added/updated for the change
- [ ] Docs updated for any behavior change
- [ ] PR describes **what** changed and **why**, with verification steps (and screenshots/GIFs for UI)
- [ ] Linked the related issue, if any

## Code review

All PRs must pass CI before merge. Reviewers may leave both issue-style comments and inline code
review comments — please address both. Thanks for contributing! ⭐
