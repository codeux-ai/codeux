# Dashboard Onboarding

The dashboard shows a first-run onboarding flow in the browser until the operator finishes or dismisses it. Completion state is persisted server-side in the settings database under user preferences (`onboardingCompletedAt`) and exposed through:
- `GET /api/user/onboarding`
- `POST /api/user/onboarding/complete`
- `POST /api/user/onboarding/cancel`
- `POST /api/user/onboarding/reset`

The browser-local key `codeux:onboarding-complete:v1` is still written for compatibility, but onboarding visibility is owned by the persisted user-preferences state so refreshes and sign-in sessions do not reopen onboarding after complete or cancel.

The onboarding shell uses the same dashboard background and modal motion system as the Import and Add Project overlays. It follows the selected Light, Dark, or System theme instead of forcing dark mode, and it can switch between the animated background and the draft static color while onboarding remains open. Appearance choices publish the same unsaved appearance preview used by Settings, so the step is previewed in place before final save. The shell is viewport-bounded, with the step body owning its own scrollbar for long provider configuration forms. The sidebar stays compact and prioritizes the step menu; it does not show provider-count or cluster-summary cards. Step entry, shortcut movement, progress feedback, selected provider/default choices, validation reveal, action feedback, and guided-tour highlight movement use the shared `enterExit`, `selectionMovement`, `inlineValidation`, `controlFeedback`, and `asyncFeedback` interaction contracts. Reduced-motion users receive static state changes, progress labels, visible outlines, and focus/selection states instead of animation-dependent cues.

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

Onboarding begins with installation checks from `GET /api/onboarding/readiness`. Dependency installation, when explicitly confirmed by the user, is invoked through `POST /api/onboarding/dependencies/install` with `{ mode, confirmInstall: true }`.

The default dashboard lifecycle probes installer prerequisites before building this payload: Linux package-manager availability (`apt`, `dnf`, `yum`, `zypper`, or `pacman`) plus `systemctl`, Homebrew on macOS, and winget on Windows. Those detected values are passed to both readiness metadata and the installer execution path so unsupported package-manager paths degrade to manual guidance instead of advertising an action that cannot run.

The readiness payload reports:
- Cluster status: `Cluster ready` or `Cluster not ready`
- Required dependencies:
  - Docker CLI
  - Docker daemon
- Structured installer metadata for safe Docker setup options:
  - `docker-desktop-git`
  - `docker-engine-git`
- Local provider auth detection for Gemini, Codex, Claude Code, Qwen Code, and OpenCode

Docker is mandatory for the default containerized workflow. Host Git is not a required dependency for the app runtime; backend Git operations use the `alpine/git` helper container. When Docker is missing or the daemon is stopped, the top-nav Docker control shows a red `Runtime not ready` alert badge with a static exclamation marker and motion-safe attention animation. The Docker status trigger also announces that the runtime is not ready, and its popover explains that provider CLIs cannot execute until Docker is reachable.

The backend installer contract is intentionally constrained. It advertises platform-specific options in the readiness payload, then the installer service executes only hardcoded executable/argument arrays for the selected `docker-desktop-git` or `docker-engine-git` mode. The install route rejects unsupported modes and missing confirmation, does not mutate settings, and does not run shell snippets, downloaded remote scripts, or interactive password prompts.

Installer support matrix:

| Platform | Recommended mode | Automated behavior | Degraded/manual behavior |
| --- | --- | --- | --- |
| macOS | `docker-desktop-git` | Homebrew installs Docker Desktop when Homebrew is available. | `docker-engine-git` is degraded because standalone Docker Engine requires a Linux VM; use Docker Desktop unless you manage that VM yourself. |
| Windows | `docker-desktop-git` | winget installs Docker Desktop with exact package IDs and package/source agreement flags. | `docker-engine-git` is degraded because Docker Engine is not installed directly on Windows desktops; use Docker Desktop or WSL guidance instead. |
| Linux | `docker-engine-git` | `apt`, `dnf`, `yum`, `zypper`, or `pacman` install Docker Engine packages, then systemd startup is attempted when `systemctl` exists. | Linux Docker Desktop is distro-artifact specific, so `docker-desktop-git` returns official Docker Desktop manual-download guidance. |

Linux Engine installation handles privileges noninteractively. Root runs package and service commands directly. Non-root runs use `sudo -n`; when passwordless sudo is unavailable, commands are returned as skipped display commands with `requiresPrivilege` guidance instead of hanging on a password prompt. Installer results include per-command status, bounded stdout/stderr summaries, short command messages, skipped dependency groups, manual-download flags, privilege flags, and post-install guidance such as starting Docker, refreshing PATH, or installing through a package manager manually. Raw command output is not repeated through per-command messages.

The reusable Installation step component stays presentational. It receives readiness metadata, selected/running installer mode, latest installer result or error, and callback props from its parent instead of calling installer APIs directly. When required Docker checks are missing and the recommended installer is available, it shows the primary `Auto Install dependencies` action with copy that explains Code UX will run the detected OS package manager only after the operator clicks. The advanced area exposes both Docker Desktop and Docker Engine choices, including availability, recommended state, degraded/manual-download guidance, privilege guidance, per-mode actions, preserved manual Docker links, live progress, structured command results, retry, and readiness recheck paths. Onboarding presents local dependency setup only.

Installer attempts never complete onboarding automatically. A resolved installer call, including `requiresPrivilege` or `requiresManualDownload` outcomes, is treated as a completed attempt: onboarding renders the structured result, keeps manual Docker links available, and re-runs readiness checks so Docker CLI and Docker daemon status refresh. Operators may need to reopen the terminal so PATH changes are visible, start Docker Desktop or the Docker Engine daemon, add their user to the Docker group, or rerun the installer from an elevated shell. Permission failures are reported as installer results or safe route errors rather than exposing full command output.

The top-nav notification center also consumes this readiness payload. Startup notifications are generated from real checks instead of placeholder messages:
- `Cluster not ready` is a non-dismissible critical notification when required dependencies are missing.
- `Startup checks passed` is a dismissible success notification when required checks pass.
- Provider auth detection creates a dismissible configuration notification with an action that reopens onboarding.
- When no provider authentication is usable, `Provider configuration required` remains visible with an onboarding recovery action.

Notification read and dismissed state is stored locally in the browser under `codeux:notification-state:v1`.

## Onboarding Steps

Onboarding now starts with a setup-mode choice. New installs default to **Expert** so existing detailed behavior remains available unless the operator chooses a shorter path. **Standard** is the user-facing spelling for the persisted `STANDARD` value.

Mode choices:
- **Easy**: short first-run path that introduces Code UX, then configures one CLI provider login plus optional GitHub workflow defaults. Easy hides Docker, concurrency, Jira, MCP, model pricing, and advanced routing controls while keeping Docker as the default execution runtime.
- **Standard**: balanced setup path that follows the detailed flow and uses the public `Standard` label in the dashboard.
- **Expert**: full provider/setup/defaults/automation/appearance flow.

The Easy path contains five steps:
1. Setup mode
   - Selects Easy, Standard, or Expert.
   - Persists the selected mode to `defaults.appearance.experienceMode`.
2. Installation
   - Uses the same Docker CLI and daemon readiness checks as Standard and Expert mode.
   - Keeps runtime failures visible before a provider is selected.
3. Introduction
   - Shows the same `Welcome to Code UX` overview used by Standard and Expert setup.
   - Explains the container-first runtime, credential boundaries, knowledge base, and MIT license before provider selection.
4. Provider
   - Shows Antigravity, Codex, Claude Code, Qwen Code, and OpenCode. Deprecated Gemini CLI is not offered in Easy mode; it remains available through Standard, Expert, and Settings for compatibility.
   - Uses an accessible radio selection, so selecting the card—not merely changing auth or opening Login—updates the Easy default.
   - Begins downloading or updating the selected provider CLI immediately. Login joins that preparation job instead of downloading again.
   - Shows only the authentication mode selector, with Dashboard Login preselected on every provider card, plus the Connect and Login action. An explicit Local Copy selection remains honored. Credential directories and local auth paths stay hidden in Easy mode. Multi-instance provider configuration stays in Standard, Expert, and Settings.
5. GitHub
   - Shows exactly two checkboxes: whether to use GitHub and whether Code UX should create/manage GitHub PR workflow defaults.
   - Leaves both GitHub checkboxes deselected by default; selecting GitHub opts into the remote PR/CI path.
   - Keeps Docker execution enabled and applies safe defaults for automation, routing, navigation, and appearance.

The Standard and Expert flow contains the detailed setup sequence:

1. Setup mode
   - Selects Easy, Standard, or Expert.
2. Installation
   - Checks Docker CLI and daemon availability.
   - Shows `Auto Install dependencies` when the recommended Docker installer can run.
   - Offers advanced Docker Desktop and Docker Engine choices, including degraded/manual setup guidance.
   - Gives Docker installation/start guidance and manual download links when required checks fail or installer results need follow-up.
   - Mirrors failed required checks in the header Docker status control as the red runtime-not-ready warning, backed by the same Docker CLI and Docker daemon readiness payload.
3. Introduction
   - Opens with a short `Welcome to Code UX` overview of the containerized agentic workspace.
   - Explains the container-first runtime model.
   - Clarifies that provider credentials stay within the intended CLI workflow instead of being reused as raw application secrets.
   - Includes placeholder action badges for GitHub, starring the project on GitHub, and documentation.
4. Provider Configuration
   - Detects local provider auth directories.
   - Lets operators choose multiple providers to activate, including Jules API-key based usage.
   - Shows provider identities with vendored, pinned Lobe Icons SVG logos for the integration catalog.
   - Provider cards behave as multi-select controls with target-specific accessible names and pressed state, so keyboard and screen-reader users can tell whether selecting the card will add or remove that provider.
5. Provider Setup
   - Provides a named-instance workspace for every selected provider.
   - Supports adding and removing multiple credential instances per provider.
   - Supports API keys, local auth-copy paths, and enablement per instance.
   - Supports Qwen modes for local auth, API-key/model-provider config, Alibaba Coding Plan, and custom endpoint details.
   - Supports OpenCode modes for local auth, provider keys, and custom OpenAI-compatible endpoint details.
   - Provider instance actions expose pending, success, warning, disabled-reason, and error feedback in live regions where the action can be retried or reversed.
6. Git
   - Selects remote or local branch generation without changing post-onboarding route behavior.
   - Remote mode exposes GitHub/GitLab tokens, GitHub auth mounting, and GitHub auth path controls with target-specific labels.
   - Git identity controls remain available in both modes; mounted host git config disables the manual identity fields.
7. Jira
   - Lets operators configure Jira later by leaving every field empty.
   - Partial Jira configuration validates as a field group: site URL and API token are required once any Jira field is filled.
   - Failed validation focuses the first invalid field and also leaves a visible alert in the step body.
8. Default Providers
   - Requires at least one enabled provider instance before routing defaults can be selected.
   - Default and worker selections use named select controls and the selected instance list marks Default, Worker, or Available status without relying on motion.
9. Automation
   - Configures system defaults for automation level, feature PR automerge, main PR automerge, plan approval, and memory.
   - Controls virtual-worker resolution for main and feature merge conflicts.
   - Enables the QA agent for completion-time review workflows.
   - Choice groups use typed settings values, keyboard-operable selection, and visible selected/success feedback.
10. Appearance
   - Configures system defaults for Theme, Navigation Mode, Reduced Motion, Background Mode, Static Color, and Zoom Level when Electron zoom support is available.
   - Previews Theme, Reduced Motion, Navigation Mode, Background Mode, Static Color, and Zoom Level immediately in both the onboarding shell and the underlying dashboard background manager.
   - Keeps advanced background controls such as Animation Style, Pattern Overlay, and custom background image in Settings -> Appearance after onboarding.

## Settings Persistence

Onboarding saves to system settings through the same `PUT /api/system-settings` path used by the Settings page.

Provider choices update:
- System integration provider auth path and `mountAuth`
- System integration API key and provider-specific mode fields
- Multiple named provider instances
- Default project provider enablement
- Legacy container auth-copy fields under `defaults.cliWorkflow` for compatibility
- Git onboarding mode under `defaults.cliWorkflow.gitMode`, which toggles the remote GitHub/GitLab setup cards and keeps git identity controls available in both modes

Provider selection also calls `POST /api/provider-tools/:provider/prepare` before settings are persisted. This request contains only a supported provider ID. Runtime/package URLs and versions are owned by the backend provider catalog.

Appearance choices update the onboarding draft under `defaults.appearance`, which is also used by the Settings page. While onboarding is open, the draft appearance is published through the shared `codeux:appearance-preview` event so the root dashboard shell reapplies Theme, Reduced Motion, Navigation Mode, Background Mode, Static Color, and Zoom Level without waiting for final save. The preview is cleared when onboarding closes, is canceled, completes, or unmounts. Final persistence still uses the same `PUT /api/system-settings` path as Settings. New installs start with sidebar navigation and the pattern overlay set to `None`.

Easy onboarding applies a small settings recipe before save: one selected CLI provider is enabled for default and worker routing, Dashboard Login is the initial auth mode for every displayed provider and is saved for the selected provider unless the operator explicitly chooses Local Copy, Docker execution stays enabled, automation remains semi-automatic with plan approval enabled, memory stays enabled, navigation stays in sidebar mode, and GitHub remains local/off unless the operator selects the GitHub checkbox. These defaults are saved only when the operator finishes the flow. Provider settings serialize broker references and non-secret configuration only.

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

- Login uses the same managed/custom runtime resolver and versioned provider-tool volume as normal invocations. It never builds a separate login image and never installs a provider CLI inside the credential session.
- Selecting a provider in onboarding begins preparation before Login is pressed. Terminal start joins the same singleflight job and mounts the verified provider volume read-only.
- Managed runtime and provider updates run during application startup. Update failures retain the previous verified digest/version; only a provider with no compatible verified tool is blocked.
- The client sends periodic terminal session heartbeats while the login modal is active.
- The client emits a termination signal on `beforeunload`, `pagehide`, and hidden visibility transitions to handle refresh, tab close, and window close.
- The server finalizes sessions idempotently when it receives explicit finalize requests.
- The server also runs a heartbeat-based sweeper and only terminates sessions with no attached clients when the heartbeat is stale, preserving active sessions that are still healthy.
- Every provider login command starts from the dedicated empty `/tmp/code-ux-login` container directory instead of `/`. The container shell starts at writable `/tmp`, creates the directory as the non-root runtime user, then changes into it before invoking the CLI. This prevents project-discovery CLIs such as Qwen Code from warning about or scanning the container root while leaving credential and provider-tool mounts unchanged.
- The pseudo-terminal advertises `xterm-256color` at 100 columns by 30 rows. The dashboard applies cursor movement and erase controls to a bounded screen model, drops non-display OSC title/color queries and DCS/APC strings even when a sequence spans WebSocket chunks, and compacts excessive blank rows without removing meaningful prompts or authentication URLs.
- Terminal output uses high-contrast white text on a near-black surface with a visible focus ring. Clicking or right-clicking the console keeps the hidden terminal input focused. The custom Paste action prevents pointer focus transfer, sends clipboard text through the active WebSocket, restores terminal focus, and reports success or clipboard denial visibly; normal Ctrl+V or Command+V input and provider keys such as arrows, Tab, Escape, and Backspace remain available.

## First-Run Container Setup Images

When the CLI workflow runs in Docker with setup-image caching enabled, Code UX builds a content-addressed setup image from the configured base image and container setup script. A cache miss now reports that the first build can take a few minutes, streams Docker build step output, and exposes bounded progress so users can distinguish a real build from a stalled provider launch. Once the image is built, future provider sessions and preview starts reuse the cached image for the same base image, setup script content, and Playwright-browser setting.

The Live runtime panels consume the same structured progress object from session activity, runtime event payloads, and invocation metadata. Build waiting and build-running states render a persistent infobox with the current step and a semantic progress bar; completion swaps the copy to a cached-image success state, while fallback reports that runtime setup is being used. Cached-image reuse without a build progress object stays quiet so users are not warned during normal fast starts.

## Post-Onboarding Tour

Finishing Standard or Expert onboarding redirects the operator to `/` and starts the dashboard guide. Finishing Easy onboarding redirects to `/chat`, where the no-project assistant offers local onboarding guidance until a project is added. It triggers the same persisted completion flow and dashboard-tour start state. The guide anchors to real UI elements through `data-tour-id` markers so it works with both dock navigation and sidebar navigation.

The guide covers:
- Projects: project management and adding the first project
- Docker Containers: container runtime readiness and running CLI containers
- Active Sessions: preview containers and browser sessions
- Each navigation destination in visible order: Chat, Overview, Sprints, Tasks, Agents, Stats, Schedule, Memory, Knowledge, Browser, Files, Live, Docs, and Settings/Config

The tour card includes previous/next controls, a skip action, the current step count, status copy, and a progress bar. Keyboard users can use Escape to close the tour, ArrowLeft/ArrowRight to move between steps, and the primary Next/Done control receives focus as the step changes. Previous, Next, Skip, and Finish controls include the target step or current location in their accessible names. Closing the tour through Escape, Skip, or Done restores focus to the control that started the tour when possible.

Reduced-motion users do not rely on ping or connector movement. The highlighted target keeps a static outline, the card shows manual step status copy, and the progress bar represents current step position instead of auto-advance timing. Hidden state is stored in the browser under `codeux:dashboard-tour-hidden:v1`.
