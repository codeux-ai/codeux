# Quickstart

This guide takes you from a clean install to a finished sprint in about 10 minutes. We will:

1. Start the Code UX server.
2. Open the dashboard.
3. Create a project pointing at a Git repository.
4. Plan a small sprint with the AI planner.
5. Run the sprint and watch it complete.

## 0. Prerequisites

- Code UX [installed](./installation.md).
- A `JULES_API_KEY` set in your environment **or** a non-Jules CLI provider installed (e.g. Gemini CLI authenticated via `gcloud auth application-default login`).
- A Git repository checked out locally that you are willing to let agents touch — preferably a scratch branch.

## 1. Start the server

In a terminal:

```bash
jules-subagents
```

You should see structured logs ending with:

```
Code UX dashboard listening on http://127.0.0.1:4444
```

Leave this terminal running.

## 2. Open the dashboard

Browse to `http://localhost:4444`. You will land on the **Overview** page, which is empty until you create your first project.

## 3. Create a project

1. Open the **Projects** page from the left dock.
2. Click **+ New project**.
3. Fill in:
   - **Name** — A label, e.g. *MyApp*.
   - **Repository path** — Absolute path to a Git checkout on disk.
   - **Default branch** — Usually `main`.
   - **Feature branch prefix** — e.g. `feature/codeux/` (used for sprint feature branches).
4. Save. The project becomes the active project and shows up across the dashboard.

## 4. Plan a sprint

1. Open the **Sprints** page.
2. Click **+ New sprint** and give it a name (e.g. *Add health endpoint*) and a one-line goal.
3. Open the new sprint, then click **AI plan**.
4. In the prompt box, describe the work, e.g.:

   > *Add a `/health` HTTP endpoint that returns service uptime and dependency status. Include unit tests and update the README.*

5. Click **Plan sprint**. The planner agent (a Gemini, Codex or Claude session, depending on your routing settings) generates a list of 2–8 subtasks with dependencies pre-wired.

You can edit, reorder, delete or add subtasks before running. The on-disk representation lives in `<repo>/.code-ux/sprints/sprint-<n>/<task-id>.md` — see [Sprint format](../developer/sprint-format.md) for the schema.

## 5. Run the sprint

1. From the sprint detail page, click **Orchestrate**. This kicks off the watch loop.
2. The dashboard switches to the **Live Session** page. You will see:
   - A header strip with elapsed time, tasks running, success rate, and quota countdown.
   - A timeline of cycle events.
   - One card per active task with live activity from its agent session.
3. As tasks complete, they enter the **merge protocol**:
   - The worker pushes its branch and opens a PR.
   - The CI gate watches the PR.
   - When CI is green (and per your auto-merge setting), Code UX merges the PR into the feature branch.
   - Dependent tasks unblock and start.
4. When all tasks are settled, the sprint either:
   - **Auto-merges** the feature branch to `main` (if `mainBranchAutoMergeMode` is set), or
   - **Pauses for manual main-branch merge** and shows you the exact `gh` command to run.
5. The sprint transitions to `completed`.

## 6. (Optional) Drive Code UX from your MCP client

Code UX is just as much an MCP server as it is a dashboard. Once you have a client like Gemini CLI or Claude Desktop wired up (see [Connecting MCP clients](./mcp-clients.md)), you can ask the LLM:

> *List my projects, then plan and orchestrate sprint 2 in MyApp.*

The model will call `manage_code_ux` (action `list` on domain `projects`, then `start` on domain `sprints`) and the same orchestration kicks off — visible in the dashboard.

## What just happened

You ran a complete cycle of the engine:

```
Plan → Cycle Runner → Start ready tasks → Worker dispatch
     → Watch Loop → Session sync → Status derivation
     → Merge Protocol (PR gate, CI gate, auto-merge)
     → Finalisation → Main branch merge
```

For the full lifecycle, see [Sprint orchestration in depth](./sprint-orchestration.md).

## Next steps

- Tune your provider routing in [Settings → Providers](./dashboard/settings.md). For example, send `task_coding` to Codex and `planning` to Claude.
- Set an [auto-merge policy](./automation-and-ci.md).
- Save reusable sprint shapes as [Quicksprint templates](./quicksprints.md).
- Learn the [dashboard surface](./dashboard/overview.md) page by page.
