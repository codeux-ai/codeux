# Quality Guardrails

Code UX includes a lightweight local guardrail script for recurring hygiene risks that are easy to miss during focused feature work.

Run it with:

```bash
pnpm run quality:guardrails
```

The script is deterministic, uses only Node built-ins, and does not read build output or require network access. It scans production TypeScript and TSX under `src/`, `dashboard/src/`, and `scripts/`, while ignoring tests, `dist/`, coverage output, lockfiles, and generated dashboard build assets.

## What It Checks

- Blocking: backup and reject artifacts such as `.orig`, `.rej`, `.bak`, and editor `~` files under source and documentation roots.
- Advisory: production TypeScript or TSX files above the configured line threshold.
- Advisory: broad `any` patterns such as `: any`, `as any`, `Array<any>`, and `Record<..., any>`.

The script exits nonzero only for high-confidence stale artifacts. Oversized files and existing broad `any` usage are reported as hotspots so maintainers can improve them during nearby work without breaking CI on accepted legacy debt.

## Thresholds

Current defaults:

| Setting | Default | Purpose |
| --- | ---: | --- |
| `CODEUX_GUARDRAIL_MAX_LINES` | `800` | Maximum advisory line count for production TypeScript and scripts. |
| `CODEUX_GUARDRAIL_DASHBOARD_MAX_LINES` | `800` | Dashboard-specific advisory line count. |
| `CODEUX_GUARDRAIL_REPORT_LIMIT` | `20` | Maximum entries shown per advisory section. |

Tune thresholds by raising or lowering the environment variables when running the script. Do not lower expectations by hiding risky files permanently; if a threshold needs to change, keep it paired with a rationale and a plan to reduce oversized modules or broad `any` usage over time.
