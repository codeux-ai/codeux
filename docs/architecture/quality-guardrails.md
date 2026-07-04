# Quality Guardrails

Code UX uses `pnpm run quality:guardrails` as a dependency-free repository drift check. The guardrail protects against two classes of quality regression in production TypeScript sources:

- oversized production files growing beyond the committed baseline
- broad `any` patterns increasing beyond the committed baseline

The scanner covers `src/` and `dashboard/src/`. It excludes generated output, dependency folders, coverage output, and test files such as `*.test.ts`, `*.spec.ts`, `tests/`, and `__tests__/`.

## Ratchet Baseline

The committed baseline lives at `scripts/quality-guardrails-baseline.json`. It records the current line count for production files above the configured oversized threshold and the current broad `any` count by production file.

Known drift is allowed only at or below the baseline. New drift fails:

- an oversized file already in the baseline fails if its line count increases
- a new production file fails if it exceeds the oversized threshold
- any production file fails if its broad `any` count increases

Reductions are allowed without immediately editing the baseline, but approved cleanup should ratchet the baseline down so the removed drift cannot return.

## Updating The Baseline

Only update the baseline after an approved refactor, file split, or type cleanup intentionally changes the tracked counts:

```bash
CODEUX_GUARDRAIL_UPDATE_BASELINE=1 pnpm run quality:guardrails
```

Review the resulting `scripts/quality-guardrails-baseline.json` diff before committing it. Baseline updates should lower or accurately reclassify existing counts; they should not hide unrelated new drift.

## Interpreting Failures

Ratchet failures include the relative file path, the baseline value, and the current value. Prefer fixing the drift directly by splitting the file, moving logic into focused modules, or replacing broad `any` with a concrete type. If the increase is intentional, document the reason in the change and update the baseline with `CODEUX_GUARDRAIL_UPDATE_BASELINE=1`.

The command also blocks untracked editor and patch backup artifacts such as `.bak`, `.backup`, `.orig`, `.rej`, and trailing-tilde files. Remove those artifacts instead of baselining them.
