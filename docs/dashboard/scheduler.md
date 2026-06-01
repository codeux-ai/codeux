# Scheduler

The Scheduler page provides project-scoped automation for future sprint starts, quicksprint launches, and timed chat-agent messages.

## Dashboard Behavior

The route is available at:
- `/scheduler`

The page has two schedule surfaces:
- `Calendar` shows recurring entries on every visible day, not only on the original entry date.
- `24 Hours` shows the selected day as an hour-by-hour timeline.

Operators can create entries for:
- Sprints whose status is not `completed`.
- Built-in or custom quicksprint templates available to the selected project.
- Messages sent into `/chat` at the selected date and time.

Scheduler target selectors, recurrence indicators, and repeating-count summary icons use the dashboard signal jade palette for interactive accents. Sprint and next-run status tones remain differentiated with their existing ember/status colors.

Repeating entries support:
- no recurrence
- hourly, daily, weekly, or monthly recurrence
- endless recurrence
- a fixed number of iterations
- an explicit end date/time

## Backend Contract

Scheduler state is persisted in SQLite in `scheduler_entries`.

The shared TypeScript contract lives in:
- `src/contracts/scheduler-types.ts`

The persistence and runtime layers live in:
- `src/repositories/scheduler-repository.ts`
- `src/services/scheduler-service.ts`
- `src/domain/scheduler/schedule-time.ts`

The dashboard API routes are:
- `GET /api/projects/:projectId/scheduler?from=<iso>&to=<iso>`
  - Returns persisted entries and expanded occurrences for the requested window.
- `POST /api/projects/:projectId/scheduler`
  - Creates a scheduler entry.
- `PATCH /api/scheduler/:entryId`
  - Updates status, timing, recurrence, or target payload.
- `DELETE /api/scheduler/:entryId`
  - Deletes an entry.

## Runtime Execution

`SchedulerService` starts with the dashboard runtime and checks due entries on an interval.

Due entries execute through existing production paths:
- sprint entries call `ExecutionControlService.orchestrateSprint`
- quicksprint entries call `QuicksprintService.executeQuicksprint`
- chat entries call `ChatThreadRuntimeService.postMessage`

After a successful run, the service advances `nextRunAt` from the scheduled occurrence time. One-time entries move to `completed`; recurring entries stay `scheduled` until their count or end date/time is exhausted. Failed entries move to `failed` with `lastError` for operator visibility.
