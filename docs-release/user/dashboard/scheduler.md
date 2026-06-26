# Scheduler

The **Scheduler** page (dock label **Schedule**, `/scheduler`) runs Code UX work on a timetable.
Schedule a sprint, a quicksprint template, or a project message to fire once or on a recurring
cadence — useful for nightly maintenance sweeps, periodic audits, or recurring planning prompts.

## Views

- **Calendar** — a month view of upcoming occurrences.
- **Day** — a focused list of what runs on a given day.

## Schedule targets

Each scheduler entry has a **target** — the thing that runs when it fires:

| Target | What it does |
| --- | --- |
| **Sprint** | Starts an existing sprint in the project. |
| **Quicksprint** | Spawns and runs a [quicksprint template](../quicksprints.md), substituting its variables. |
| **Message** | Posts a project message (for example, a recurring planning or status prompt). |

## Recurrence

An entry can run once at a specific time or repeat on a **recurrence rule** (for example daily or
weekly). The page previews the next occurrences so you can confirm the cadence before saving.

## Managing entries

From the page you can:

- **Create** an entry — pick a target, set the time, and choose a recurrence rule.
- **Edit** an entry's target, time, or recurrence.
- **Pause / resume** an entry without deleting it.
- **Run now** to trigger an entry immediately.
- **Delete** an entry.

Scheduler changes broadcast over the dashboard's realtime channel, so the calendar stays in sync
across open clients. Scheduled runs appear in the [Live Session](./live-session.md) and
[Stats](./stats.md) views just like manually started work.
