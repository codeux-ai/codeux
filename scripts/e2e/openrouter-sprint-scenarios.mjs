export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-5-mini";

export const TERMINAL_TASK_STATUSES = new Set(["completed", "QA_REVIEW_FAILED"]);
export const SUCCESS_TASK_STATUSES = new Set(["completed"]);

export const SCENARIOS = [
  {
    id: "conflict-dag",
    name: "5-task merge-conflict DAG sprint",
    timeoutMs: 60 * 60 * 1000,
    sprint: {
      name: "OpenRouter merge-conflict DAG validation",
      goal: [
        "Validate a five-task DAG that exercises merge-conflict handling in an isolated local repository.",
        "Keep changes minimal and deterministic. Do not access external services except the configured provider runtime.",
      ].join("\n\n"),
    },
    tasks: [
      {
        key: "conflict-base",
        title: "Prepare deterministic shared module",
        priority: "high",
        sourceType: "merge_conflict",
        promptMarkdown: [
          "Update `src/shared-state.js` so it exports a named `getSharedMessage()` function returning a stable validation message.",
          "Also update `README.md` with a short note that the shared message is used by sprint validation.",
        ].join("\n\n"),
      },
      {
        key: "conflict-left",
        title: "Add left branch shared-state consumer",
        priority: "medium",
        sourceType: "merge_conflict",
        dependsOn: ["conflict-base"],
        promptMarkdown: [
          "Create `src/left-consumer.js` that imports `getSharedMessage()` and exports `leftConsumer()`.",
          "Append a left-consumer note to `README.md` near the validation note.",
        ].join("\n\n"),
      },
      {
        key: "conflict-right",
        title: "Add right branch shared-state consumer",
        priority: "medium",
        sourceType: "merge_conflict",
        dependsOn: ["conflict-base"],
        promptMarkdown: [
          "Create `src/right-consumer.js` that imports `getSharedMessage()` and exports `rightConsumer()`.",
          "Append a right-consumer note to `README.md` near the validation note.",
        ].join("\n\n"),
      },
      {
        key: "conflict-join",
        title: "Join shared consumers",
        priority: "high",
        sourceType: "merge_conflict",
        dependsOn: ["conflict-left", "conflict-right"],
        promptMarkdown: [
          "Create `src/joined-consumers.js` that imports both consumers and exports `joinedConsumers()`.",
          "The returned string should include both consumer results in a deterministic order.",
        ].join("\n\n"),
      },
      {
        key: "conflict-verify",
        title: "Verify joined shared-state output",
        priority: "medium",
        sourceType: "merge_conflict",
        dependsOn: ["conflict-join"],
        promptMarkdown: [
          "Add or update `test/run-validation.mjs` so `node test/run-validation.mjs` verifies the joined consumer output.",
          "Keep the test dependency-free and make it fail with a clear message if expected text is absent.",
        ].join("\n\n"),
      },
    ],
  },
  {
    id: "ci-repair",
    name: "1-task random CI failure/repair sprint",
    timeoutMs: 35 * 60 * 1000,
    sprint: {
      name: "OpenRouter CI repair validation",
      goal: [
        "Validate that a single task can repair a deterministic CI-style failure in an isolated local repository.",
        "The repository includes a failing validation script; fix the implementation so the script passes.",
      ].join("\n\n"),
    },
    tasks: [
      {
        key: "ci-repair-1",
        title: "Repair deterministic CI validation failure",
        priority: "critical",
        sourceType: "failed_ci",
        promptMarkdown: [
          "Run `node test/run-validation.mjs` and repair the implementation failure it reports.",
          "Do not delete the validation script. Make the smallest code change that makes the script pass.",
        ].join("\n\n"),
      },
    ],
  },
  {
    id: "smoke",
    name: "3-task smoke sprint",
    timeoutMs: 30 * 60 * 1000,
    sprint: {
      name: "OpenRouter smoke validation",
      goal: [
        "Validate that a three-task sprint can run end-to-end against an isolated local repository.",
        "Keep all changes simple, deterministic, and dependency-free.",
      ].join("\n\n"),
    },
    tasks: [
      {
        key: "smoke-1",
        title: "Add greeting utility",
        priority: "medium",
        promptMarkdown: "Create `src/greeting.js` exporting `greeting()` that returns `hello from code ux`.",
      },
      {
        key: "smoke-2",
        title: "Add greeting validation",
        priority: "medium",
        dependsOn: ["smoke-1"],
        promptMarkdown: [
          "Update `test/run-validation.mjs` to import `greeting()` from `src/greeting.js`.",
          "The script should assert that the returned value is exactly `hello from code ux`.",
        ].join("\n\n"),
      },
      {
        key: "smoke-3",
        title: "Document greeting utility",
        priority: "low",
        dependsOn: ["smoke-2"],
        promptMarkdown: "Update `README.md` with one sentence describing the greeting utility.",
      },
    ],
  },
];

export function getScenario(id) {
  return SCENARIOS.find((scenario) => scenario.id === id) || null;
}

export function listScenarioIds() {
  return SCENARIOS.map((scenario) => scenario.id);
}
