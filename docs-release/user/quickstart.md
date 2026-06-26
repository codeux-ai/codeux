# Quickstart

This guide takes you from a clean install to a finished sprint in about ten minutes. You will start
Code UX, create a project, plan a small sprint with the AI planner, run it, and watch it merge.

## Prerequisites

- Code UX [installed](./installation.md).
- At least one provider available — a `JULES_API_KEY`, or a local CLI provider you have
  authenticated (for example the Gemini CLI). See [Providers and models](./providers-and-models.md).
- A local Git repository you are willing to let agents work on — ideally on a scratch branch.
- Docker running, if you want containerized execution (the default).

## 1. Start Code UX

Launch the desktop app, or from a terminal:

```bash
codeux
```

Wait for the dashboard to come up, then open **`http://localhost:4444`**. You will land on the
**Overview** page, which is empty until you add a project.

## 2. Create a project

1. Open the **Projects** page from the left navigation.
2. Click **New project**.
3. Provide:
   - **Name** — a label, e.g. *MyApp*.
   - **Repository** — an absolute path to a local Git checkout, or a Git URL to clone.
   - **Default branch** — usually `main`.
   - **Feature branch prefix** — e.g. `feature/codeux/`, used for sprint branches.
4. Save. The project becomes active across the dashboard.

> Optionally let the **Project Setup Agent** inspect the repository and generate tailored agent
> presets, quicksprint templates, and preview scripts. See
> [Project initialization](./dashboard/projects.md).

## 3. Configure a provider

If you have not already, open **Settings → Providers** and enable at least one provider:

- **Jules** — paste an API key.
- **A local CLI provider** — authenticate its CLI (Code UX auto-detects local auth) and choose Docker
  or host execution.

See [Providers and models](./providers-and-models.md) for routing work to different providers by
invocation type.

## 4. Plan a sprint

1. Open the **Sprints** page and click **New sprint**. Give it a name and a one-line goal.
2. Open the sprint and click **AI plan**.
3. Describe the work, for example:

   > Add a `/health` HTTP endpoint that returns service uptime and dependency status. Include unit
   > tests and update the README.

4. Click **Plan sprint**. The planner generates a set of dependency-aware tasks. Review, edit,
   reorder, add, or remove tasks before running.

The on-disk representation lives under `<repo>/.code-ux/sprints/` — see
[Sprint format](../developer/sprint-format.md) for the schema.

## 5. Run the sprint

1. From the sprint, click **Orchestrate**. Code UX starts the watch loop and switches to the
   **Live Session** page.
2. You will see elapsed time, tasks running, and a live timeline. Each ready task runs in its own
   worker; independent tasks run in parallel.
3. As tasks finish, they enter the **merge protocol**: the worker pushes its branch, opens a PR/MR,
   Code UX watches CI, and — per your policy — merges it into the feature branch, unblocking
   dependent tasks.
4. When all tasks settle, the sprint either auto-merges the feature branch into your default branch
   or pauses for a manual merge, then transitions to `completed`.

Anything the runtime cannot resolve on its own (a stubborn merge conflict, CI failing past the retry
budget, a plan needing approval) appears as an **attention item** for you to handle.

## What just happened

You ran a full cycle of the engine:

```
Plan → schedule ready tasks → dispatch workers (Docker/host)
     → watch loop (session sync, status derivation)
     → merge protocol (PR gate, CI gate, auto-merge)
     → finalize → merge feature branch
```

For the full lifecycle, see [Sprint orchestration](./sprint-orchestration.md).

## Optional: drive Code UX from an MCP client

Code UX is also an MCP server. Once a client such as the Gemini CLI or Claude Code is connected
(see [MCP clients](./mcp-clients.md)), you can ask it to list projects and plan or orchestrate a
sprint, and the same run appears live in the dashboard.

## Next steps

- Tune routing in [Providers and models](./providers-and-models.md) — e.g. plan with one model, code
  with another.
- Set an [automation and CI policy](./automation-and-ci.md).
- Save reusable shapes as [Quicksprint templates](./quicksprints.md).
- Explore the [dashboard](./dashboard/overview.md) surface by surface.
