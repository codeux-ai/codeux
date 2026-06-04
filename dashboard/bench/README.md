# Dashboard performance benchmark harness

Measures frontend performance of the production build per route: cold-load
cost, main-thread blocking (long tasks), JS heap, DOM size, and a rapid
"navigate-fast" storm that surfaces jank and memory/DOM leaks.

## Files

- **`stub-server.mjs`** — serves `dashboard/dist` and answers `/api/*` (+ the
  realtime WebSocket) with synthetic data, so heavy list rendering is exercised
  without the real orchestrator. Volume is tunable:
  `TASK_COUNT` (60), `PROJECT_COUNT` (30), `SPRINT_COUNT` (12),
  `BG_MODE` (`ANIMATED`|`STATIC`), `BG_ANIM` (`deep-ocean`…), `PORT` (4599).
- **`benchmark.mjs`** — spawns the stub, drives Chrome (Playwright), and writes
  `results-<bgmode>.json` / `results-<bgmode>.md`. Live progress streams to
  `progress.log`.

## Prerequisites

```bash
npm run build           # produce dashboard/dist (the harness serves this)
```

Chrome/Chromium must be installed (Playwright `channel: "chrome"`).

## Run

```bash
# Build first, then:
node dashboard/bench/benchmark.mjs                 # animated background (default)
BG_MODE=STATIC node dashboard/bench/benchmark.mjs  # static background baseline

# Bench a live server (e.g. the real orchestrator dashboard on :4444) instead
# of the stub:
node dashboard/bench/benchmark.mjs --url http://localhost:4444
```

Output: `dashboard/bench/results-*.md` (human) + `results-*.json` (raw).

## ⚠️ Headless GPU note

This dashboard busy-spins `requestAnimationFrame` when there is no vsync, and
its WebGL backgrounds crash software GL. So:

- **Run with a real GPU / real display** (a normal dev machine). The harness
  launches Chrome with the GPU **on** by default.
- Pure-headless CI boxes with no GL will hang/crash the renderer — this is the
  same class of issue worth fixing in the app (gate rAF loops on
  `document.visibilityState` and `prefers-reduced-motion`; pause WebGL when
  hidden). `NOGPU=1` exists but will reproduce the hang on this app.

## Interpreting results

- **Cold `blockingMs`** — main-thread time in long tasks during load. High =
  janky first paint for that route.
- **Rapid-nav `blockingMs` / `maxTaskMs`** — jank while navigating fast.
- **Rapid-nav `heapGrowthMB` / `domGrowth` after GC** — the leak signal:
  memory/detached-DOM that survives forced GC across repeated navigation.
