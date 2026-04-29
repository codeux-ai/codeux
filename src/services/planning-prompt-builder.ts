import type { AgentPresetRecord } from "../contracts/agent-preset-types.js";
import type { MemoryRecord } from "../contracts/memory-types.js";

/**
 * Input for improving a sprint prompt.
 */
export interface ImprovePromptArgs {
  projectName: string;
  planningAgent: AgentPresetRecord;
  sprintName: string;
  goal: string;
  memoryContext?: string;
  learningsInstruction?: string;
}

/**
 * Input for planning a sprint into subtasks.
 */
export interface PlanPromptArgs {
  projectName: string;
  planningAgent: AgentPresetRecord;
  sprintNumber: number | null;
  sprintName: string;
  goal: string;
  memoryContext?: string;
  learningsInstruction?: string;
}

/**
 * Builds a prompt for the planning agent to refine a sprint goal.
 */
export function buildImprovePrompt(args: ImprovePromptArgs): string {
  const parts = [
    "You are Sprint OS's Planning agent.",
    "",
    "## Planning Agent Instructions",
    args.planningAgent.instructionMarkdown.trim() || "Refine sprint prompts into crisp, implementation-ready scopes.",
    "",
    "## Task",
    "Scan the repository to understand the context, then improve the sprint prompt. Do not break it into tasks yet.",
    `Project: ${args.projectName}`,
    `Sprint: ${args.sprintName.trim() || "Untitled sprint"}`,
    "",
    "## Current Prompt",
    args.goal.trim() || "No prompt provided.",
  ];

  if (args.memoryContext) {
    parts.push("", args.memoryContext);
  }

  parts.push(
    "",
    "## Guidance",
    "- Use file discovery or codebase search to clarify symbols, paths, or architectural patterns mentioned or implied by the prompt.",
    "- Ground the improved prompt in the actual reality of the codebase.",
    "- Be concise but technically precise.",
    "",
    "## Required Output",
    "Return JSON only with this exact shape and no surrounding commentary:",
    '{"goal":"Improved sprint prompt"}',
  );

  if (args.learningsInstruction) {
    parts.push("", "## LEARNINGS CAPTURE (Required)", "", args.learningsInstruction);
  }

  return parts.join("\n");
}

/**
 * Builds a prompt for the planning agent to decompose a sprint goal into a DAG of subtasks.
 */
export function buildPlanPrompt(args: PlanPromptArgs): string {
  const memorySection = args.memoryContext ? `\n${args.memoryContext}\n` : "";
  const parts = [
    "You are Sprint OS's Planning agent.",
    "",
    "## Planning Agent Instructions",
    args.planningAgent.instructionMarkdown.trim() || "Break sprint goals into actionable subtasks.",
    "",
    "## Task",
    "Plan the sprint into implementation-ready subtasks.",
    `Project: ${args.projectName}`,
    `Sprint: ${args.sprintNumber ? `SPR-${args.sprintNumber}` : args.sprintName}`,
    `Sprint Name: ${args.sprintName}`,
    "",
    "## Sprint Goal",
    args.goal.trim() || "No sprint goal provided.",
    memorySection,
    "",
    "## Constraints",
    "- Plan as a DAG, not as a flat checklist.",
    "- Prefer 3 to 8 tasks unless the scope clearly demands more or fewer.",
    "- Maximize parallelism; add dependencies only for true code blockers.",
    "- Each task must be independently understandable and self-contained.",
    "- Each task key must use `T01`, `T02`, `T03`, ... in topological order.",
    "- Dependencies must only reference keys defined earlier in the task list.",
    "- Do not create branch, PR, merge, coordination, analysis-only, or placeholder tasks.",
    "- Use `auto` executor unless a task clearly needs `docker_cli` or `jules`.",
    "- `description` must be one concise sentence.",
    "- `promptMarkdown` must use this exact section order: `## Objective`, `## Scope`, `## Implementation Requirements`, `## Constraints`, `## Verification`.",
    "- `promptMarkdown` must name exact files, modules, or symbols whenever they can be inferred.",
    "",
    "## Output Rules",
    "- Return JSON only.",
    "- Return one top-level object with `goal` and `tasks`.",
    "- Return one ordered `tasks` array for the full DAG.",
    "- Do not wrap the JSON in prose.",
    "",
    "## Task Object Schema",
    "{",
    '  "key": "T01",',
    '  "title": "Short imperative title",',
    '  "description": "One-sentence outcome statement.",',
    '  "promptMarkdown": "## Objective\\n...\\n\\n## Scope\\n- ...\\n\\n## Implementation Requirements\\n1. ...\\n\\n## Constraints\\n- ...\\n\\n## Verification\\n- ...",',
    '  "priority": "medium",',
    '  "executorType": "auto",',
    '  "dependsOn": []',
    "}",
    "",
    "## Example Output A",
    "{",
    '  "goal": "Add project override indicators and keep inherited fields unbadged.",',
    '  "tasks": [',
    "    {",
    '      "key": "T01",',
    '      "title": "Add override metadata helper",',
    '      "description": "Create a shared helper that resolves whether each settings field is overridden at project scope.",',
    '      "promptMarkdown": "## Objective\\nAdd a shared helper that converts effective settings source metadata into per-field override display state for the project settings UI.\\n\\n## Scope\\n- dashboard/src/v2/lib/settings-view-models.ts\\n- tests/dashboard/lib/settings-view-models.test.ts\\n\\n## Implementation Requirements\\n1. Add a helper that determines whether a field is overridden or inherited.\\n2. Return no badge state for inherited values.\\n3. Cover overridden and inherited cases with focused tests.\\n\\n## Constraints\\n- Keep source resolution centralized.\\n- Preserve existing effective settings contracts.\\n\\n## Verification\\n- Run the focused settings view-model test file.\\n- Confirm overridden fields resolve to override state and inherited fields resolve to no badge state.",',
    '      "priority": "high",',
    '      "executorType": "auto",',
    '      "dependsOn": []',
    "    },",
    "    {",
    '      "key": "T02",',
    '      "title": "Render override badges in settings UI",',
    '      "description": "Apply the shared override metadata to the project settings controls.",',
    '      "promptMarkdown": "## Objective\\nUse the shared override metadata helper to render the project override badge only on overridden settings controls.\\n\\n## Scope\\n- dashboard/src/v2/SettingsPage.tsx\\n- dashboard/src/v2/components/settings/ProjectSettingsEditor.tsx\\n\\n## Implementation Requirements\\n1. Read per-field override metadata from the shared helper.\\n2. Show the badge only for overridden controls.\\n3. Keep inherited controls free of placeholder badge UI.\\n\\n## Constraints\\n- Reuse existing settings row patterns.\\n- Keep layout stable when no badge is present.\\n\\n## Verification\\n- Verify overridden controls show the badge and inherited controls do not.\\n- Run relevant dashboard tests if present.",',
    '      "priority": "medium",',
    '      "executorType": "auto",',
    '      "dependsOn": ["T01"]',
    "    }",
    "  ]",
    "}",
    "",
    "## Example Output B",
    "{",
    '  "goal": "Fix sprint finalization so no-output tasks do not block completion.",',
    '  "tasks": [',
    "    {",
    '      "key": "T01",',
    '      "title": "Centralize merge settlement rules",',
    '      "description": "Create a shared helper that classifies whether a completed task still has merge work outstanding.",',
    '      "promptMarkdown": "## Objective\\nIntroduce one shared helper for deciding whether a completed task is coding-complete only or fully complete, including the no-output case.\\n\\n## Scope\\n- src/domain/sprint/task-merge-state.ts\\n- src/domain/sprint/ci/feature-pr-gate.ts\\n- tests/backend/domain/sprint/ci/feature-pr-gate.test.ts\\n\\n## Implementation Requirements\\n1. Add a reusable helper for merge settlement classification.\\n2. Treat completed tasks with no PR URL and no worker branch as settled.\\n3. Cover the no-output case with regression tests.\\n\\n## Constraints\\n- Preserve existing behavior for PR-backed tasks.\\n- Keep the helper side-effect free.\\n\\n## Verification\\n- Run focused backend tests for feature PR gating.\\n- Confirm no-output tasks are treated as settled while PR-backed tasks still wait for merge when required.",',
    '      "priority": "high",',
    '      "executorType": "auto",',
    '      "dependsOn": []',
    "    },",
    "    {",
    '      "key": "T02",',
    '      "title": "Use merge settlement helper in sprint completion",',
    '      "description": "Apply the shared settlement rules to watch-loop and status-derivation completion decisions.",',
    '      "promptMarkdown": "## Objective\\nUpdate sprint finalization so tasks without merge work advance cleanly to final completion and do not block sprint completion.\\n\\n## Scope\\n- src/domain/sprint/orchestrator/watch-loop-runner.ts\\n- src/sprint/steps/status-derivation-step.ts\\n- src/sprint/steps/protocol-step.ts\\n- tests/backend/sprint/watch-loop-core.test.ts\\n\\n## Implementation Requirements\\n1. Replace duplicated merge-wait logic with the shared helper.\\n2. Auto-complete tasks that have no merge work after coding is done.\\n3. Add regression coverage for sprint completion with no-output tasks.\\n\\n## Constraints\\n- Do not mark PR-backed tasks complete before merge conditions are satisfied.\\n- Keep dependency unlock behavior consistent.\\n\\n## Verification\\n- Run focused sprint runtime tests.\\n- Confirm no-output tasks complete automatically and real merge-backed tasks still wait when required.",',
    '      "priority": "high",',
    '      "executorType": "auto",',
    '      "dependsOn": ["T01"]',
    "    }",
    "  ]",
    "}",
    "",
    "## Required Output",
    "Return JSON only with this exact shape and no surrounding commentary:",
    '{"goal":"Optional refined sprint goal","tasks":[{"key":"T01","title":"Task title","description":"Short intent","promptMarkdown":"## Objective\\n...\\n\\n## Scope\\n- ...\\n\\n## Implementation Requirements\\n1. ...\\n\\n## Constraints\\n- ...\\n\\n## Verification\\n- ...","priority":"medium","executorType":"auto","dependsOn":[]}]}',
  ];

  if (args.learningsInstruction) {
    parts.push("", "## LEARNINGS CAPTURE (Required)", "", args.learningsInstruction);
  }

  return parts.join("\n");
}

/**
 * Formats memory records into a structured context block for the planning prompt.
 */
export function buildMemoryContext(longTerm: MemoryRecord[], shortTerm: MemoryRecord[]): string | undefined {
  if (longTerm.length === 0 && shortTerm.length === 0) {
    return undefined;
  }

  const sections: string[] = ["## PROJECT CONTEXT FROM MEMORY"];
  
  if (longTerm.length > 0) {
    sections.push("### Long-Term Knowledge");
    for (const m of longTerm) {
      sections.push(`- [${m.category}] ${m.content.slice(0, 300)}`);
    }
  }
  
  if (shortTerm.length > 0) {
    sections.push("### Recent Sprint Learnings");
    for (const m of shortTerm) {
      sections.push(`- [${m.category}] ${m.content.slice(0, 300)}`);
    }
  }
  
  return sections.join("\n");
}
