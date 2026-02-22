# SPRINT PLANNING GUIDE — TECHNICAL SKILL

You are the Planning Specialist. Your role is to transform high-level requirements in `sprints/sprint-<N>.md` into a DAG (Directed Acyclic Graph) of atomic, executable subtasks for Jules.

## 1. Requirement Decomposition Principle

- **Atomic**: Each subtask must focus on a single, isolated unit of work (e.g., "Implement the `User` model and its migrations").
- **Testable**: Each task MUST have a verifiable outcome. Define the expected tests or CLI outputs in the `prompt` field.
- **Independent**: Jules works best on tasks that do not require human decision-making. Flag these as `is_independent: true`.
- **Sequential**: If Task B depends on the code changes from Task A, Task B MUST list `task-A` in its `depends_on` array.

## 2. Subtask Markdown Format

For every subtask, create a file named `<task-id>.md` in `sprints/sprint<N>-subtasks/`:

```markdown
title: <Short descriptive title>
depends_on: [<dependency-task-id-1>, <dependency-task-id-2>]
is_independent: <true | false>
prompt:
As a senior developer, your task is to:
1. <Action 1: Implement X>
2. <Action 2: Update Y>
3. <Action 3: Verify with Z>

## Engineering Standard
- Adhere to the technical baseline in `worker.md`.
- Use the feature branch: feature/sprint<N>-<description> (created and pushed by the orchestrator via `git`).
- Ensure all tests pass before completing.
```

## 3. Heuristics for "Jules-Ready" Tasks

| Characteristic | Jules-Ready? | Action |
|---|---|---|
| Large refactor across multiple domains | No | Break into domain-specific subtasks. |
| Implementing a new API endpoint | Yes | Provide the schema and route details. |
| Fixing a bug with a known reproduction | Yes | Provide the reproduction steps in the prompt. |
| UI/UX design exploration | No | Handle this as a manual blocker task. |
| Infrastructure as Code (Terraform) | Yes | Provide the provider and resource specs. |

## 4. Final Review Checklist

Before finishing the planning phase:
1.  **Circular Dependency Check**: Ensure there are no cycles in the `depends_on` graph.
2.  **Prompt Clarity**: Read each prompt. Is it a direct command? Is it ambiguous?
3.  **Path Accuracy**: Ensure all referenced file paths in the prompt are correct.
4.  **Verification Steps**: Does the prompt include how the agent should verify its work?
