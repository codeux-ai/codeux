# Goals

Goals are project-scoped outcomes that can drive autonomous sprint planning.

Examples:
- Finalize frontend UI
- Complete checkout process
- Improve test coverage

## Dashboard Behavior

Goals are managed from:
- `/projects`

Project cards include a full-width **Goals** action. The goal dialog supports:
- adding a goal title and optional description
- marking goals completed
- reopening completed goals
- archiving/restoring goals
- deleting goals

Goals can also be entered while adding a project. The add-project form accepts one optional goal per line and persists them with the newly created project.

## Goal Sprint Planning

The Sprints page includes a **Goal Sprint** composer.

Operators can:
- select active project goals
- add a new goal directly from the composer
- set minimum and maximum task counts
- set minimum and maximum sprint counts
- override the Planning agent
- override the planning route/provider
- override the model when a virtual provider route is selected
- choose `Plan & Start` or `Plan Only`

Goal Sprint planning sends the selected goals and bounds to the Planning agent. The planner returns one or more sprint plans. Code UX validates the returned sprint and task bounds before creating any records.

Created goal sprints are normal project sprints:
- each sprint is persisted in `sprints`
- each planned task is persisted in `tasks`
- sprint task dependencies use the existing task DAG model
- dependency-free planned sprints start immediately when `Plan & Start` is selected
- planned sprints with sprint-level dependencies are created idle with dependency context in the sprint goal

## Scheduler

The Scheduler page supports a `Goal Sprint` target.

Scheduled goal sprint entries store:
- selected goal IDs
- minimum and maximum task counts
- minimum and maximum sprint counts
- submit mode
- planning override metadata when provided

When the entry fires, Scheduler calls the same Goal Sprint planner used by the Sprints page.

## Backend Contract

Goals are stored in SQLite in:
- `project_goals`

Dashboard routes:
- `GET /api/projects/:projectId/goals`
- `POST /api/projects/:projectId/goals`
- `PATCH /api/project-goals/:goalId`
- `DELETE /api/project-goals/:goalId`
- `POST /api/projects/:projectId/goal-sprints/plan`

Shared contracts live in:
- `src/contracts/project-management-types.ts`
- `src/contracts/scheduler-types.ts`

Implementation files:
- `src/repositories/project-management-repository.ts`
- `src/services/planning-agent-service.ts`
- `src/services/planning-prompt-builder.ts`
- `src/services/scheduler-service.ts`
- `dashboard/src/v2/ProjectsPage.tsx`
- `dashboard/src/v2/components/goals/GoalSprintPanel.tsx`
- `dashboard/src/v2/SchedulerPage.tsx`

## Current Boundary

The first shipped slice creates multi-sprint goal plans and starts dependency-free sprints. It persists sprint-level dependency intent in the generated sprint goal text. A dedicated persisted sprint-dependency executor is still needed before dependent goal sprints can be automatically started the moment predecessor sprints complete outside a scheduler-triggered planning run.
