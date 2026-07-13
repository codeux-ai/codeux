# Sprint Rollbacks

Code UX models a rollback as a new sprint, not as destructive history editing. The original sprint remains auditable, while the rollback receives its own branch, tasks, execution history, and visual identity. Remote projects deliver the branch through a pull request; local projects merge it locally without creating one.

## Choosing the execution path

Before creation, Code UX checks the completed source sprint, Git mode, later sprint activity, and the source merge at the tip of the default branch.

- **Automatic rollback** is offered only for a proven isolated latest merge with no later sprint work. Code UX reverts that merge in a detached worktree and enforces a hard no-dispatch boundary for its settled audit task. Remote mode pushes the dedicated rollback branch and completes it through a green pull request. Local mode keeps the branch local and merges it into the configured default branch without a pull request.
- **Agent-assisted rollback** is used when later work may depend on the source, merge history is ambiguous, a deterministic revert conflicts, or you enter custom instructions.

Entering instructions always selects the agent path. This is how you request a partial rollback such as “remove only feature XY but keep the migration.” The agent is told to inspect dependencies, preserve compatible work, and update tests. It pushes only in remote mode; local mode commits to the rollback branch without remote access.

## Delivery by Git mode

Remote rollback sprints force live PR tracking even when ordinary sprint PR monitoring is disabled. Automatic rollbacks use green-check auto-merge; agent-assisted rollbacks retain the configured merge policy, with `OFF` promoted to `CREATE_PR`. A remote rollback sprint completes only after the Git host reports the PR merged.

Local rollback sprints do not fetch, push, or create a PR. Code UX uses its standard isolated local finalization worktree to merge the rollback branch into the configured default branch, preserving a dirty visible checkout and surfacing merge conflicts through attention handling. The sprint completes only after the local merge succeeds.

## Dashboard identity

Rollback gallery cells and ledger rows use an orange treatment, a rollback badge, and distinct action copy. Their normal run status, task progress, CI state, review state, and human-attention indicators remain visible.

See [Sprints](../user/dashboard/sprints.md) for the operator workflow.
