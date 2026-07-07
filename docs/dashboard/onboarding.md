# Dashboard Onboarding

The dashboard shows a first-run onboarding flow in the browser until the operator finishes or dismisses it. Completion state is persisted server-side in the settings database under user preferences (`onboardingCompletedAt`) and exposed through:
- `GET /api/user/onboarding`
- `POST /api/user/onboarding/complete`
- `POST /api/user/onboarding/cancel`
- `POST /api/user/onboarding/reset`

The browser-local key `codeux:onboarding-complete:v1` is still written for compatibility, but onboarding visibility is owned by the persisted user-preferences state so refreshes and sign-in sessions do not reopen onboarding after complete or cancel.

The onboarding shell uses the same animated dashboard background and modal motion system as the Import and Add Project overlays. Onboarding forces the shared background into its dark palette and applies quieter color grading so the setup UI remains legible while still feeling integrated with the app. The shell is viewport-bounded, with the step body owning its own scrollbar for long provider configuration forms. Step entry, shortcut movement, progress feedback, selected provider/default choices, validation reveal, action feedback, and guided-tour highlight movement use the shared `enterExit`, `selectionMovement`, `inlineValidation`, `controlFeedback`, and `asyncFeedback` interaction contracts. Reduced-motion users receive static state changes, progress labels, visible outlines, and focus/selection states instead of animation-dependent cues.

## Component Structure

The onboarding UI is orchestrated by `OnboardingExperience.tsx`, which delegates rendering logic to individual step components under `dashboard/src/v2/components/onboarding/`:
- `OnboardingInstallationStep.tsx`
- `OnboardingIntroductionStep.tsx`
- `OnboardingProvidersStep.tsx`
- `OnboardingProviderSetupStep.tsx`
- `OnboardingGitStep.tsx`
- `OnboardingJiraStep.tsx`
- `OnboardingDefaultsStep.tsx`
- `OnboardingAutomationStep.tsx`
- `OnboardingAppearanceStep.tsx`

Navigation and step-sequencing state is managed by the shared `useOnboardingStepFlow` hook, allowing the orchestrator to act purely as a view-router and state-manager while the step components remain thin and focused. The hook owns a typed reducer for the onboarding session: modal visibility, active step, readiness payload, selected providers, the settings draft, saving state, and the displayed error. `OnboardingExperience.tsx` still performs the API calls, but it commits API results and user interactions through explicit reducer actions instead of coordinating independent `useState` setters.

## Runtime Readiness

Onboarding begins with installation checks from `GET /api/onboarding/readiness`.

The readiness payload reports:
- Cluster status: `Cluster ready` or `Cluster not ready`
- Required dependencies:
  - Docker CLI
  - Docker daemon
  - Git CLI
- Structured installer metadata for safe Docker/Git setup options:
  - `docker-desktop-git`
  - `docker-engine-git`
- Local provider auth detection for Gemini, Codex, Claude Code, Qwen Code, and OpenCode

Docker is mandatory for the default containerized workflow. When Docker is missing or the daemon is stopped, the top-nav Docker control also shows a `Cluster not ready` badge and its popover explains that provider CLIs cannot execute until Docker is reachable.

The backend installer contract is intentionally constrained. It advertises platform-specific options in the readiness payload, then the installer service executes only hardcoded executable/argument arrays. It does not run shell snippets, downloaded remote scripts, or interactive password prompts.

Installer support matrix:

| Platform | Recommended mode | Automated behavior | Degraded/manual behavior |
| --- | --- | --- | --- |
| macOS | `docker-desktop-git` | Homebrew installs Docker Desktop and Git when Homebrew is available. | `docker-engine-git` is degraded because standalone Docker Engine needs a Linux VM; it can only automate Git through Homebrew. |
| Windows | `docker-desktop-git` | winget installs Docker Desktop and Git with exact package IDs and package/source agreement flags. | `docker-engine-git` is degraded with WSL/Docker Desktop guidance; it can only automate Git through winget. |
| Linux | `docker-engine-git` | Supported package managers install Docker Engine packages and Git, then systemd startup is attempted when `systemctl` exists. | `docker-desktop-git` is degraded to automated Git installation plus official Docker Desktop manual-download guidance because Desktop artifacts are distro-specific. |

Linux Engine installation handles privileges noninteractively. Root runs package and service commands directly. Non-root runs use `sudo -n`; when passwordless sudo is unavailable, commands are returned as skipped display commands with `requiresPrivilege` guidance instead of hanging on a password prompt. Installer results include per-command status, bounded stdout/stderr summaries, skipped dependency groups, manual-download flags, privilege flags, and post-install guidance such as starting Docker, refreshing PATH, or installing through a package manager manually.

The reusable Installation step component stays presentational. It receives readiness metadata, selected/running installer mode, latest installer result or error, and callback props from its parent instead of calling installer APIs directly. When required Docker/Git checks are missing and the recommended installer is available, it shows the primary `Auto Install dependencies` action with copy that explains Code UX will run the detected OS package manager only after the operator clicks. The advanced area exposes both `Docker Desktop + Git` and `Docker Engine + Git`, including availability, recommended state, degraded/manual-download guidance, privilege guidance, per-mode actions, preserved manual Docker/Git links, live progress, structured command results, retry, and readiness recheck paths.

The top-nav notification center also consumes this readiness payload. Startup notifications are generated from real checks instead of placeholder messages:
- `Cluster not ready` is a non-dismissible critical notification when required dependencies are missing.
- `Startup checks passed` is a dismissible success notification when required checks pass.
- Provider auth detection creates a dismissible configuration notification with an action that reopens onboarding.

Notification read and dismissed state is stored locally in the browser under `codeux:notification-state:v1`.

## Onboarding Steps

The flow currently contains nine detailed steps, with the provider configuration area grouped in the sidebar:

1. Installation
   - Checks Docker and Git availability.
   - Shows `Auto Install dependencies` when the recommended Docker/Git installer can run.
   - Offers advanced Docker Desktop + Git and Docker Engine + Git choices, including degraded/manual setup guidance.
   - Gives Docker installation/start guidance and manual download links when required checks fail or installer results need follow-up.
2. Introduction
   - Opens with a short `Welcome to Code UX` overview of the containerized agentic workspace.
   - Explains the container-first runtime model.
   - Clarifies that provider credentials stay within the intended CLI workflow instead of being reused as raw application secrets.
   - Includes placeholder action badges for GitHub, starring the project on GitHub, and documentation.
3. Provider Configuration
   - Detects local provider auth directories.
   - Lets operators choose multiple providers to activate, including Jules API-key based usage.
   - Shows provider identities with vendored, pinned Lobe Icons SVG logos for the integration catalog.
   - Provider cards behave as multi-select controls with target-specific accessible names and pressed state, so keyboard and screen-reader users can tell whether selecting the card will add or remove that provider.
4. Provider Setup
   - Provides a named-instance workspace for every selected provider.
   - Supports adding and removing multiple credential instances per provider.
   - Supports API keys, local auth-copy paths, and enablement per instance.
   - Supports Qwen modes for local auth, API-key/model-provider config, Alibaba Coding Plan, and custom endpoint details.
   - Supports OpenCode modes for local auth, provider keys, and custom OpenAI-compatible endpoint details.
   - Provider instance actions expose pending, success, warning, disabled-reason, and error feedback in live regions where the action can be retried or reversed.
5. Git
   - Selects remote or local branch generation without changing post-onboarding route behavior.
   - Remote mode exposes GitHub/GitLab tokens, GitHub auth mounting, and GitHub auth path controls with target-specific labels.
   - Git identity controls remain available in both modes; mounted host git config disables the manual identity fields.
6. Jira
   - Lets operators configure Jira later by leaving every field empty.
   - Partial Jira configuration validates as a field group: site URL and API token are required once any Jira field is filled.
   - Failed validation focuses the first invalid field and also leaves a visible alert in the step body.
7. Default Providers
   - Requires at least one enabled provider instance before routing defaults can be selected.
   - Default and worker selections use named select controls and the selected instance list marks Default, Worker, or Available status without relying on motion.
8. Automation
   - Configures system defaults for automation level, feature PR automerge, main PR automerge, plan approval, and memory.
   - Controls virtual-worker resolution for main and feature merge conflicts.
   - Enables the QA agent for completion-time review workflows.
   - Choice groups use typed settings values, keyboard-operable selection, and visible selected/success feedback.
9. Appearance
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
- Git onboarding mode under `defaults.cliWorkflow.gitMode`, which toggles the remote GitHub/GitLab setup cards and keeps git identity controls available in both modes

Appearance choices update `defaults.appearance`, which is also used by the Settings page. The root dashboard shell listens for settings updates and Settings-page preview events, then reapplies theme, reduced-motion, navigation, background mode/style/color, uploaded image, and pattern preferences without a page reload. New installs start with sidebar navigation and the pattern overlay set to `None`.

Operators can reopen onboarding from `Settings -> General -> Onboarding`. The action resets the persisted onboarding completion state and clears the browser-local marker; it does not reset saved system or project settings.

## Validation And Feedback

Onboarding forms keep changes in a local settings draft until the final save. The footer exposes a live status that distinguishes draft-ready, runtime-readiness checking, pending save, and retryable save-error states. The Installation step disables and renames the Recheck action while readiness is pending, while Finish changes to a disabled Saving action during persistence.

Validation runs when the operator tries to continue from steps that need complete field groups. Partially configured Jira credentials require both the site URL and API token, while the Defaults step requires at least one enabled provider instance before defaults can be selected. Invalid submits render an alert inside the scrollable step body, then focus the first invalid field or the nearest actionable control. The alert remains visible for context, and scrolling uses reduced-motion-safe behavior when motion is disabled.

Step changes restore focus to the active step heading so keyboard users receive a stable landing point after Back, Next, and shortcut navigation. The primary sidebar step list owns `aria-current="step"` for the current step. Footer shortcut controls keep their original `Go to <step>` accessible names for compatibility while reflecting selection visually through the shared selection movement token.


## Settings Draft Management

Onboarding settings state is managed purely without component side effects by helper functions in `dashboard/src/v2/lib/onboarding-settings-draft.ts` and reducer actions in `dashboard/src/v2/components/onboarding/use-onboarding-step-flow.ts`. The reducer applies settings recipes against a typed `structuredClone` copy of the current `SystemSettings` draft instead of JSON stringify/parse cloning, preserving optional fields and the current settings shape while keeping presentation components from mutating loaded API objects. These pure helpers process provider choices and system integration states directly into `SystemSettings` structures before they are flushed. This ensures:
- Derived defaults are consistent across initial render, interactions, and final save.
- Tests can independently verify provider sync behaviors without a full UI test harness.
- Form controls map user intent strictly to Draft states instead of managing API formats internally.

## Interactive Login Session Cleanup

Dashboard-guided provider login sessions now use an explicit lifecycle protocol to prevent orphaned Docker login containers after browser interruptions.

- On dashboard startup, Code UX starts a best-effort background prewarm for the pinned login base image (`node:24-bookworm-slim` plus curl and keyring prerequisites). Startup does not wait for this image build, and provider login still retries image preparation on demand if Docker is unavailable or the prewarm fails.
- The first interactive login after a fresh install may still wait while Docker builds or verifies the login base image. When the terminal start contract or WebSocket stream includes the structured container build progress object (`kind`, `imageTag`, `baseImage`, `message`, optional `progressPercent`, and optional `stepText`), the login modal shows a persistent build status infobox before the terminal becomes active. The copy explains that the container needs to be built, the first build can take time, and future login sessions reuse the cached image unless the Dockerfile content changes.
- The client sends periodic terminal session heartbeats while the login modal is active.
- The client emits a termination signal on `beforeunload`, `pagehide`, and hidden visibility transitions to handle refresh, tab close, and window close.
- The server finalizes sessions idempotently when it receives explicit finalize requests.
- The server also runs a heartbeat-based sweeper and only terminates sessions with no attached clients when the heartbeat is stale, preserving active sessions that are still healthy.

## First-Run Container Setup Images

When the CLI workflow runs in Docker with setup-image caching enabled, Code UX builds a content-addressed setup image from the configured base image and container setup script. A cache miss now reports that the first build can take a few minutes, streams Docker build step output, and exposes bounded progress so users can distinguish a real build from a stalled provider launch. Once the image is built, future provider sessions and preview starts reuse the cached image for the same base image, setup script content, and Playwright-browser setting.

The Live runtime panels consume the same structured progress object from session activity, runtime event payloads, and invocation metadata. Build waiting and build-running states render a persistent infobox with the current step and a semantic progress bar; completion swaps the copy to a cached-image success state, while fallback reports that runtime setup is being used. Cached-image reuse without a build progress object stays quiet so users are not warned during normal fast starts.

## Post-Onboarding Tour

Finishing onboarding redirects the operator to `/` and starts the dashboard guide. The guide anchors to real UI elements through `data-tour-id` markers so it works with both dock navigation and sidebar navigation.

The guide covers:
- Projects: project management and adding the first project
- Docker Containers: container runtime readiness and running CLI containers
- Active Sessions: preview containers and browser sessions
- Each navigation destination in visible order: Chat, Overview, Sprints, Tasks, Agents, Stats, Schedule, Memory, Knowledge, Browser, Files, Live, Docs, and Settings/Config

The tour card includes previous/next controls, a skip action, the current step count, status copy, and a progress bar. Keyboard users can use Escape to close the tour, ArrowLeft/ArrowRight to move between steps, and the primary Next/Done control receives focus as the step changes. Previous, Next, Skip, and Finish controls include the target step or current location in their accessible names. Closing the tour through Escape, Skip, or Done restores focus to the control that started the tour when possible.

Reduced-motion users do not rely on ping or connector movement. The highlighted target keeps a static outline, the card shows manual step status copy, and the progress bar represents current step position instead of auto-advance timing. Hidden state is stored in the browser under `codeux:dashboard-tour-hidden:v1`.
