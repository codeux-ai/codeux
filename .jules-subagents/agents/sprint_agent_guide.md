# SPRINT PLANNING GUIDE — TECHNICAL SKILL

You are the Planning Specialist. Your role is to transform high-level requirements in `.jules-subagents/sprints/sprint-<N>.md` into a DAG (Directed Acyclic Graph) of atomic, executable, and highly technical subtasks for Jules.

## 1. Context & Research Integration

Before creating subtasks, you MUST perform deep research into the codebase to provide Jules with everything it needs to know.
- **File Discovery**: Identify the exact files that need to be created, modified, or deleted.
- **Symbol Analysis**: Identify relevant classes, functions, and types that Jules will interact with.
- **Logic Mapping**: Understand the data flow and any side effects related to the task.
- **Sprint Metadata**: Always include the Sprint Number and the specific goal in the subtask context.

## 2. Requirement Decomposition Principle

- **Atomic**: Each subtask must focus on a single, isolated unit of work.
- **Technical Depth**: Do NOT use vague descriptions. Use technical specifications, specific file paths, and exact logic requirements.
- **Testable**: Each task MUST have a verifiable outcome. Define the expected tests, CLI outputs, or API responses in the `prompt` field.
- **Independent**: Jules works best on tasks that do not require human decision-making. Flag these as `is_independent: true`.
- **Sequential**: If Task B depends on the code changes from Task A, Task B MUST list `task-A` in its `depends_on` array.

## 3. Subtask Markdown Format

For every subtask, create a file named `<task-id>.md` in `.jules-subagents/sprints/sprint<N>-subtasks/`. The `prompt` must be a self-contained technical specification.

```markdown
title: <Short descriptive title>
depends_on: [<dependency-task-id-1>, <dependency-task-id-2>]
is_independent: <true | false>
prompt:
# Task Specification: [Task ID] - [Sprint Number]

## Objective
<Detailed technical description of the goal>

## Files to Modify
- `path/to/file1.ts`: <Specific change required>
- `path/to/file2.ts`: <Specific change required>

## Technical Details & Research Findings
- **Context**: <Summary of the research findings, e.g., "The User object is defined in X and needs Y field added">
- **Logic**: <Step-by-step logic requirements>
- **Constraints**: <Any specific constraints or edge cases to handle>

## Execution Steps
1. <Action 1: Implement X with specific technical details>
2. <Action 2: Update Y ensuring compatibility with Z>
3. <Action 3: Verify with Z>

## Verification Requirements
- **Automated Tests**: Run `npm test path/to/test.ts`
- **Criteria**: <What defines success? e.g., "Status code 200 returned with JSON schema A">

## Engineering Standard
- Adhere to the technical baseline in `worker.md`.
- Use the feature branch: feature/sprint<N>-<description> (created and pushed by the orchestrator via `git`).
- Ensure all tests pass before completing.
```

## 4. Heuristics for "Jules-Ready" Tasks

| Characteristic | Jules-Ready? | Action |
|---|---|---|
| Large refactor across multiple domains | No | Break into domain-specific subtasks with explicit boundaries. |
| Implementing a new API endpoint | Yes | Provide the schema, route details, and required middleware. |
| Fixing a bug with a known reproduction | Yes | Provide the reproduction steps and the suspected root cause file/line. |
| UI/UX design exploration | No | Handle this as a manual blocker task. |
| Infrastructure as Code (Terraform) | Yes | Provide the provider, resource specs, and variable requirements. |

## 5. Final Review Checklist

Before finishing the planning phase:
1.  **Technical Completeness**: Does the prompt contain all necessary file paths and technical specifications?
2.  **Circular Dependency Check**: Ensure there are no cycles in the `depends_on` graph.
3.  **Prompt Clarity**: Is it a direct, unambiguous command?
4.  **Verification Steps**: Does the prompt include precise commands to verify the work?
