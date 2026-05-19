# Dashboard Onboarding

The dashboard shows a first-run onboarding flow in the browser until the operator finishes or dismisses it. Completion is tracked with the browser-local key `codeux:onboarding-complete:v1`, so each browser profile can onboard independently.

The onboarding shell uses the same animated dashboard background and modal motion system as the Import and Add Project overlays. Onboarding forces the shared background into its dark palette and applies quieter color grading so the setup UI remains legible while still feeling integrated with the app. The shell is viewport-bounded, with the step body owning its own scrollbar for long provider configuration forms.

## Runtime Readiness

Onboarding begins with installation checks from `GET /api/onboarding/readiness`.

The readiness payload reports:
- Cluster status: `Cluster ready` or `Cluster not ready`
- Required dependencies:
  - Docker CLI
  - Docker daemon
  - Git CLI
- Local provider auth detection for Gemini, Codex, Claude Code, Qwen Code, and OpenCode

Docker is mandatory for the default containerized workflow. When Docker is missing or the daemon is stopped, the top-nav Docker control also shows a `Cluster not ready` badge and its popover explains that provider CLIs cannot execute until Docker is reachable.

The top-nav notification center also consumes this readiness payload. Startup notifications are generated from real checks instead of placeholder messages:
- `Cluster not ready` is a non-dismissible critical notification when required dependencies are missing.
- `Startup checks passed` is a dismissible success notification when required checks pass.
- Provider auth detection creates a dismissible configuration notification with an action that reopens onboarding.

Notification read and dismissed state is stored locally in the browser under `codeux:notification-state:v1`.

## Onboarding Steps

The flow currently contains six steps:

1. Installation
   - Checks Docker and Git availability.
   - Gives Docker installation/start guidance when required checks fail.
2. Introduction
   - Opens with a short `Welcome to Code UX` overview of the containerized agentic workspace.
   - Explains the container-first runtime model.
   - Clarifies that provider credentials stay within the intended CLI workflow instead of being reused as raw application secrets.
   - Includes placeholder action badges for GitHub, starring the project on GitHub, and documentation.
3. Provider Configuration
   - Detects local provider auth directories.
   - Lets operators choose multiple providers to activate, including Jules API-key based usage.
   - Shows provider identities with vendored, pinned Lobe Icons SVG logos for the integration catalog.
4. Provider Setup
   - Provides a named-instance workspace for every selected provider.
   - Supports adding and removing multiple credential instances per provider.
   - Supports API keys, local auth-copy paths, and enablement per instance.
   - Supports Qwen modes for local auth, API-key/model-provider config, Alibaba Coding Plan, and custom endpoint details.
   - Supports OpenCode modes for local auth, provider keys, and custom OpenAI-compatible endpoint details.
5. Automation
   - Configures system defaults for automation level, feature PR automerge, main PR automerge, plan approval, and memory.
   - Controls virtual-worker resolution for main and feature merge conflicts.
   - Enables the QA agent for completion-time review workflows.
6. Appearance
   - Configures system defaults for theme, motion, and navigation mode.
   - Explains primary dashboard controls such as project selection, sprint scope, worker routing, and Settings.

## Settings Persistence

Onboarding saves to system settings through the same `PUT /api/system-settings` path used by the Settings page.

Provider choices update:
- System integration provider auth path and `mountAuth`
- System integration API key and provider-specific mode fields
- Multiple named provider instances
- Default project provider enablement
- Legacy container auth-copy fields under `defaults.cliWorkflow` for compatibility

Appearance choices update `defaults.appearance`, which is also used by the Settings page. The root dashboard shell listens for settings updates and Settings-page preview events, then reapplies theme, reduced-motion, navigation, background mode/style/color, uploaded image, and pattern preferences without a page reload.

Operators can reopen onboarding from `Settings -> General -> Onboarding`. The action clears only the browser-local onboarding completion marker and does not reset saved system or project settings.

## Post-Onboarding Tour

Finishing onboarding redirects the operator to `/` and starts the dashboard guide. The guide anchors to real UI elements through `data-tour-id` markers so it works with both dock navigation and sidebar navigation.

The guide covers:
- Projects: project management and adding the first project
- Docker Containers: container runtime readiness and running CLI containers
- Active Sessions: preview containers and browser sessions
- Each navigation destination: Chat, Overview, Sprints, Tasks, Agents, Stats, Memory, Browser, Live, and Settings/Config

The tour card includes previous/next controls, a hide action, the current step count, and an auto-advance progress bar. Hidden state is stored in the browser under `codeux:dashboard-tour-hidden:v1`.
