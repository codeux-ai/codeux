# OpenRouter Sprint Validation

`scripts/e2e/run-openrouter-sprint-validation.mjs` runs optional end-to-end sprint validation against OpenRouter through the existing Code UX runtime APIs.

The runner is secret-gated. If `OPENROUTER_API_KEY` is not set, it prints a skip message and exits with status 0. This lets CI wire the script before the secret is configured.

## Runtime Behavior

- Starts `dist/index.js` on a free local dashboard port.
- Uses an isolated temporary `HOME` and `USERPROFILE` under `.cache/e2e-openrouter/`.
- Creates an isolated temporary local git repository for each selected scenario.
- Configures the existing `codex` provider instance with `OPENROUTER_API_KEY`, `https://openrouter.ai/api/v1`, and `CODEUX_E2E_OPENROUTER_MODEL` or the runner default.
- Creates projects, sprints, and tasks through the dashboard project, sprint, task, settings, and orchestration APIs.
- Polls task state until every task reaches a terminal state or the scenario timeout expires.
- Writes redacted JSON summaries under `.cache/e2e-openrouter/<run-id>/`.

## GitHub Actions

`.github/workflows/openrouter-sprint-e2e.yml` runs this validation on pushes to `main` and through manual dispatch. The workflow installs dependencies with pnpm 11.13.1 on Node 22, builds the compiled runtime, and then invokes the runner.

The workflow passes `OPENROUTER_API_KEY` from repository secrets. Until that secret is configured, the runner prints its skip message and exits successfully. Set the optional repository variable `CODEUX_E2E_OPENROUTER_MODEL` to override the default model; otherwise the workflow uses `openai/gpt-5-mini`.

Runner artifacts under `.cache/e2e-openrouter/` are uploaded when validation fails or when the runner creates artifacts, with a short retention period.

## Scenarios

- `conflict-dag`: a five-task merge-conflict DAG sprint.
- `ci-repair`: a one-task deterministic CI failure repair sprint.
- `smoke`: a three-task dependency-chain smoke sprint.

Run all scenarios:

```bash
OPENROUTER_API_KEY=... node scripts/e2e/run-openrouter-sprint-validation.mjs
```

Run the smoke scenario only:

```bash
OPENROUTER_API_KEY=... node scripts/e2e/run-openrouter-sprint-validation.mjs --scenario smoke
```

Build first because the runner intentionally uses the compiled entrypoint:

```bash
pnpm run build
```

Set `CODEUX_E2E_OPENROUTER_MODEL` to override the default OpenRouter model. The runner redacts provider keys and authorization headers before writing summaries or process logs.
