---
layout: home

hero:
  name: Code UX
  text: The open-source agentic coding runtime
  tagline: Orchestrate the agent CLIs you already use in isolated Docker workspaces — planned, parallel, and tracked in a live local dashboard. Free and MIT licensed.
  actions:
    - theme: brand
      text: Get Started
      link: /user/quickstart
    - theme: alt
      text: Install
      link: /user/installation
    - theme: alt
      text: Download
      link: https://github.com/codeux-ai/codeux/releases/latest
    - theme: alt
      text: GitHub
      link: https://github.com/codeux-ai/codeux

features:
  - title: Multi-provider routing
    details: Route work across Jules, Claude Code, Codex, Gemini, Qwen Code, OpenCode, and Antigravity — with per-provider weights, concurrency, and model defaults.
  - title: Docker-first execution
    details: Provider CLIs run in short-lived, isolated Docker workspaces by default, with reusable caches, deliberate auth mounting, and startup cleanup.
  - title: Sprint orchestration
    details: Plan from a prompt, issue, or quicksprint template into a dependency-aware DAG, then run ready tasks in parallel with CI gates and merge discipline.
  - title: Sprint-aware memory
    details: Short-term sprint memory and long-term project memory keep prompts focused and token-efficient — no ever-growing transcript.
  - title: Git, CI & issue imports
    details: Branch prep, PR/MR discovery, CI polling and merge gates, automated CI repair, and issue import from GitHub, GitLab, and Jira.
  - title: Live browser previews
    details: One isolated preview container per sprint, rendered inside the dashboard with logs, port mapping, and rebuilds as tasks complete.
---

## Install in seconds

```bash
npm i -g @codeuxai/codeux
codeux
```

Then open the dashboard at [http://localhost:4444](http://localhost:4444). Requires Node.js 22+.
Prefer a desktop app? [Download the latest release](https://github.com/codeux-ai/codeux/releases/latest)
for Windows, macOS (Apple Silicon), or Linux.

Code UX is released under the [MIT License](https://github.com/codeux-ai/codeux/blob/main/LICENSE).
If it's useful to you, please [star it on GitHub](https://github.com/codeux-ai/codeux).
