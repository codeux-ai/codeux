# Chat

The **Chat** page (`/chat`) is a thread-based conversation surface that lets you talk to agents for project-backed Q&A, inspect execution invocation transcripts and MCP tool invocations, and get local onboarding help before any project exists.

## Layout

- **No-project assistant** — When no project is selected, `/chat` shows a local onboarding assistant instead of a project-required empty state. It presents the Code UX assistant avatar, five quick bubbles, local replies, and explicit buttons for Add Project, Projects, Settings, onboarding, and docs. It does not create conversation threads, persist messages, or call project-scoped chat APIs.
- **Dedicated assistant surface** — Chat interactions stay on `/chat`; the dashboard shell does not cover other pages with a floating assistant overlay. Use the Chat navigation entry to open project threads, invocation transcripts, or no-project onboarding help.
- **Left rail** — In project chat, two tabs:
  - **Threads** — Conversation threads scoped to the active project.
  - **Invocations** — A historical log of server-created execution invocations, including provider-backed agent runs and MCP `CallTool` activity.
- **Main panel** — The active thread (or invocation), rendered as a chat transcript with user, assistant, and tool messages. Markdown is rendered with `marked`, including code blocks.

Markdown links use the dashboard's theme-aware signal colors across thread messages, invocation transcripts, truncated system messages, and 3D Chat. In dark mode they render in high-contrast mint with a brighter jade hover/focus state instead of a fixed dark blue; provider-branded badges retain their own readable semantic colors.

3D chat and agent avatar surfaces use the standard WebGL avatar with studio lighting and pointer-aware head movement. The removed flashlight beam, target glow, low-battery flicker, and emissive shell boost are no longer part of the chat layout; reduced-motion settings or WebGL fallback mode continue to use the static SVG avatar.

While the Project Manager is genuinely idle, the 3D stage can show one short ambient cue at a time: a greeting, wink, curious glance, dance beat, or a text-labelled humming cue with decorative notes. Returning to the page produces a welcome-back cue only after the stage was hidden or idle for at least 30 seconds, so quick tab changes stay quiet. Sending, Project Manager work, errors, hidden pages, and reduced-motion mode stop these cue timers and the stage's continuous decorative drift. The static mood caption, connection status, and unrelated background-activity count remain visible and truthful. Ambient cue text is visible but is not repeatedly announced as a live status update.

The 3D stage enters its Project Manager working state only while the selected thread awaits that agent's reply or a running dashboard/worker reply invocation belongs to the same resolved agent preset. Other agents' replies and unrelated task, planning, or CI invocations remain truthful background activity; they do not make the Project Manager show a thinking expression, work tool, active caption, or busy-only quick-action state. Sending a message keeps its separate routing state until the awaited reply or matching invocation is visible.

The thought area turns known runtime fields into compact cues for container startup, provider work, planning, QA review, completion, and errors. Current stage cues come only from running records or the selected thread's awaited reply; old completed or failed invocations are not presented as live activity. A delegated-work cue stays visible while the Project Manager remains idle, and an active Project Manager cue takes precedence while retaining a count of other activity. The phase is shown directly without `Background` or provider-name prefixes. Its workplace-safe quote is keyed by stable agent, provider, phase, and runtime context and stays unchanged for at least twenty seconds. Delegated work uses 72 original agency and project-management jokes about coworker handoffs, meetings, scope creep, client feedback, and ticket rituals. The runtime shuffles the deck by context, uses every line before reshuffling, and avoids immediate repeats. Reduced-motion mode keeps the status text while stopping its decorative dots.

During the selected Project Manager's provider-working phase, the avatar rotates through five work tools every seven seconds: Power screwdriver (`screwdriver`), Jackhammer (`jackhammer`), Open-end wrench (`wrench`), Claw hammer (`hammer`), and Welding torch (`torch`). Container startup keeps the thinking state without a tool. Background work never equips a tool. Maintainers can pin a valid catalog identifier with `/chat?stageTool=<identifier>` for design review; missing or unsupported values leave normal runtime selection in place. Reduced-motion and WebGL fallback surfaces replace tool animation with the visible tool label and an accessible avatar description.

When a text-to-speech model or API is active under **Settings -> AI Models**, 3D Chat reads new Project Manager replies aloud. A compact control dock beneath the avatar identity holds the microphone and agent mute/unmute buttons, outside the composer. Voice defaults on, shows synthesis activity, and can be muted immediately. The preference is remembered per project in the current browser; opening an existing thread does not replay its latest historical message. If synthesis or browser playback fails, 3D Chat shows the voice error beside the controls so a silent failure can be corrected.

## No-project assistant

The no-project assistant is local onboarding guidance for the browser page. Its five quick bubbles are:

- Add my first project.
- Build a desktop app.
- Build a web app.
- Explain Code UX.
- Change settings.

Quick bubbles only add local user/assistant turns. Actions such as creating a project, opening settings, restarting onboarding, or reading docs remain explicit buttons and continue through the existing dashboard flows. Provider-backed chat is project-scoped; it starts only after a project exists and a persistent thread can be created or selected.

## Threads

A *thread* is a persistent conversation with an agent. Each thread has:

- A **title** (editable inline).
- A **routing config** — which agent preset and provider answers when you post a message.
- A **session** — the underlying provider session. Sessions can be **compacted** (summarised) to fit within context limits.

New dashboard chat threads derive an 8-word-or-less title from the first visible user message. Code UX stores the title in sqlite and mirrors it to `.code-ux/conversations/<thread-id>/session-title.md` inside the project checkout; manual title edits update both places. Prompt preparation also includes a title-refresh instruction every 20 provider invocations so long-running conversations can update their title from current context.

To rename a thread, use the edit control beside the active thread title. The inline editor supports pointer and keyboard workflows: Enter saves, Escape cancels, explicit save/cancel buttons are available, and empty titles are rejected before the request is sent. Successful renames update the active header and left rail from the returned backend thread record without reloading the transcript. Long titles wrap or truncate inside the header, while rail titles clamp to two readable lines.

To start a new thread, click **+ New thread**. To change the responding agent, open the thread header dropdown and pick from the list of agent presets defined for this project.

Each post is a runtime operation that honors the explicit route chosen (worker route, virtual provider route, automatic live-worker pickup, or fallback). The dashboard exposes in-flight state locally, allowing you to cancel active thread turns or invocations. Failed invocation restarts preserve the failed invocation transcript and expose the existing sanitized error message with a retry action.

The project chat composer saves your latest draft in SQLite per dashboard user, project, and active chat context, and also mirrors the active typed text to browser-local storage immediately so a page refresh cannot lose recent keystrokes while the backend write is still pending. Leaving `/chat`, switching away and back, or reloading restores the matching draft for the current new-thread composer or selected thread without reusing drafts from another project or browser user. While a project switch is settling, Code UX uses the new-thread composer until the selected thread is confirmed to belong to the new project, preventing a previous project's thread draft from being requested or saved under the new project. Blank drafts are recorded as empty locally and remove the saved row, and sending still clears the composer after the message is accepted.

The composer also keeps a recent-message history for successful project chat sends. Press ArrowUp or ArrowDown while composing to preview messages submitted by the current dashboard user in the current project; a fresh dashboard user starts with no recalled messages. Single-line drafts can recall history directly, while multi-line drafts keep normal textarea cursor movement unless the caret is at the true start or end. Code UX preserves the current draft while you cycle through history and restores it when you move back past the newest recalled entry.

When the Project Manager schedules its own continuation, that follow-up is visibly different from a message you wrote. Thread and 3D Chat render an agent-scheduled wakeup as a dedicated Project Manager continuation card, with the exact next-step instruction and its queued, running, completed, or failed state. The card explicitly says it was scheduled by the agent, so automated follow-ups remain auditable without being mistaken for user-authored prompts.

Scheduled continuations are single-flight within their originating thread. If that thread is already generating a reply, the scheduler leaves the wakeup due instead of claiming it, then checks again as soon as the active reply finishes. If a wakeup is accepted during the narrow reply-finalization window, it stays queued without interrupting the current response. Multiple queued wakeups are combined in their stored order into one continuation, while messages you type keep their normal newer-message supersession behavior and are never merged into an agent-scheduled continuation.

Cancelling from the dashboard stops only the selected active turn. The cancelled prompt is not automatically replayed and does not produce an additional worker-failure reply; other threads and separately queued scheduled continuations remain eligible to run. Genuine provider failures still appear as one visible failure reply and leave the affected message in a failed delivery state for inspection.

## Create app quickactions

Use **Create Web App**, **Create Desktop App**, **Create Onlineshop** (the Online shop action), **Create Portfolio**, or **Create Game** when you want Code UX to start an app-building sprint in the selected project from chat. In Threads mode, the buttons sit beside the composer and are also available in an empty thread whenever project chat is idle. They hide while sending, working, or showing an error.

Clicking a quickaction starts immediately. You do not need to type composer text first, and Code UX does not show a confirmation step. If there is no active thread yet, the dashboard creates one, posts a short visible message such as `Create a web app`, and starts the matching quicksprint in detached `Plan & Start` mode while you stay in Chat. Its catalog-selected experience guidance applies to that plan only and does not change saved project settings.

All five create-app actions appear only for projects persisted as `new-local` or `new-remote` whose repository is still the clean Code UX seed. The project directory must be the repository root, Git must contain exactly one commit, and the root and tracked tree must contain only the generated `README.md` and `.gitignore`. The README must retain its initial `# <project name>` and `Initialized with Code UX.` content; the only effective ignore entry may be `.code-ux/` or `.code-ux`. Imported or legacy projects, setup artifacts, dirty or ignored extra content, altered seed files, additional files or commits, missing checkouts, and inspection errors all fail closed. The dashboard refreshes eligibility after project structure and Git changes, and the server verifies it again at launch, so every create-app action disappears after setup or any repository change. Invalid kind, template, or guidance metadata fails safely instead of starting a different sprint.

Each action has a fixed template and request-scoped guidance mapping:

| Action | Template | Planning guidance |
| --- | --- | --- |
| **Create Web App** | `qs-create-web-app` | Product journeys, information architecture, service boundaries, responsive/accessibility states, and operational validation using the Code UX product stack and product-grade interface guidance. |
| **Create Desktop App** | `qs-create-desktop-app` | Window/process lifecycle, safe privileged operations, local data, recovery, packaging, resizing, and keyboard behavior using the Electron desktop stack and product-grade interface guidance. |
| **Create Onlineshop** | `qs-create-online-shop` | Discovery through order completion, including money, inventory, checkout, payment, privacy, idempotency, and failure recovery, with commerce guidance. |
| **Create Portfolio** | `qs-create-portfolio` | Narrative, real evidence and content, contact paths, responsive semantics, reduced motion, performance, metadata, and discoverability, with marketing-site guidance. |
| **Create Game** | `qs-create-game` | A core play loop, deterministic state and controls, progression/recovery, accessible alternatives, performance budgets, and a runnable play-through, with game-experience guidance. |

The quickaction also carries the active project's effective techstack into planning: the selected catalog entry when assigned, or the catalog default when the project is unassigned. Stack item labels become suggestion tags, so the progress widget and planner begin from the same stack context visible in the dashboard. Catalog guidance is applied only to this planning request, reconciled with stronger repository instructions, and never saved as a project setting.

The transcript then shows an app progress widget instead of raw status data. The widget reports:

- whether the sprint is for a web app, desktop app, online shop, portfolio, or game
- the app sprint name
- selected stack details such as framework, runtime, package manager, styling, and tests when available
- planning stages from Planning through Plan, Showing each Task, Start, and Finish
- suggestion tags that can guide your next message

You can keep sending messages in the same thread while planning runs. If the planner has not created tasks yet, Code UX marks those messages processed, queues them on the thread, and acknowledges the queue. Successful planning flushes them to the sprint goal under `Additional direction from chat`. Once tasks exist, follow-ups append to that sprint direction immediately and the thread confirms the update. Generated task prompts and existing subtasks are not rewritten; failed planning retains queued text for recovery instead of discarding it.

After you send a message, the thread transcript updates from the server's returned chat message. The **Invocations** rail updates separately from persisted server invocation records and realtime refreshes, so it shows only backend-confirmed invocation rows. The dashboard no longer inserts a frontend-only optimistic invocation placeholder while the backend is still creating the real row.

While a reply or invocation container is active, the visible status line uses light deterministic humor instead of static `Initializing` or `Working` copy. These messages are keyed by the active agent, provider/model, and phase, and they remain stable for at least five seconds so live regions do not churn during rapid refreshes. The funny line is a UI adjunct only; it does not replace the actual agent reply, invocation status, or stored transcript.

In 3D Chat, the complete idle set is the five create-app actions together with **Status Report**, **Sprint Progress**, **What’s Failing?**, **Plan Next Steps**, **Add Nodes Workflow**, **Add Dashboard**, **Create Skill**, and **List Skills**. The create-app buttons use the typed detached quicksprint path described above. The other eight buttons are normal chat actions: they immediately send their fixed informational or workflow prompt through the selected project's routed Thread and do not create detached app planning. Neither path inserts into, replaces, or clears text already in the composer.

On desktop the controls are sorted into subtle **Create**, **Project pulse**, and **Workflows** clusters contained inside the left side of the stage. Each category wraps its small content-width chips together, keeping Sprint Progress and Plan Next Steps with Project pulse and keeping Add Dashboard, Create Skill, and List Skills with Workflows. Small offsets, extra whitespace, and gentle staggered drift keep the composition interesting without clipping controls or crowding the avatar. On mobile the controls retain the same category order in horizontally scrollable two-row groups. Neutral chip surfaces and distinct colored icon tiles make the actions easier to scan without giving every action the same green emphasis. Labels stay on one line. Every control is a keyboard-reachable button with a visible focus state, and Enter or Space activates it. Reduced-motion mode stops the quickaction floating animation (along with the stage's other decorative motion) without removing actions or status text. The whole group hides without a selected project and while chat is sending, working, or showing an error; all five create-app actions also remain hidden until initial-project eligibility has loaded and passed.

Planning messages can include a rich sprint status card. When Code UX can match the message to loaded live project data, the card is backed by the current task records and execution snapshot, so it updates as tasks move from queued to running, completed, failed, blocked, or quota-waiting. It shows the sprint key/name, request/task/run materialization, overall progress such as `0/7 · 0%`, queued task count, and a compact task list. If either task records or the execution snapshot are still loading, the chat keeps the generic planning status card until both live records are available for the active project.

Threads also surface the same rich reasoning, tool activity, and planning cards that were previously only visible in the Invocations transcript. Code UX selects these cards from message metadata, so reasoning turns, planning request messages, and paired tool calls/results appear inline in the normal conversation instead of falling back to raw transcript text. Matching tool-call and tool-result messages are paired by their metadata call id and shown as one activity card.

Chat messages and invocation transcripts can also turn sprint and task references into live cards when they match real records in the active project. Sprint cards show the sprint status and completion progress, preserving one decimal when needed, then link to the matching Sprint page. Task cards show the task status, priority, executor, and sprint context, then link to the matching Tasks page. Code UX only enriches references it can resolve in the active project; stale references stay as normal text, and ambiguous task keys are not guessed. Dashboard links can be relative `/sprints` or `/tasks` links, or absolute links on the current dashboard origin; external-origin links are left as normal transcript text. Sprint cards refresh after both project-structure and execution-telemetry changes through the existing lightweight sprint collection, not through a separate chat stream or heavy live snapshot.

Virtual chat replies can persist structured prompt suggestions for quick next steps. JSON-mode providers may return optional `suggestions` alongside `replyMarkdown` and `action`; Code UX stores valid entries on the assistant/system message as `metadata.promptSuggestions` after trimming strings, dropping malformed entries, and capping the list at six. Suggestions appear as clickable tags below the normal markdown reply, so the transcript remains visible. Clicking a tag sends that prompt immediately without inserting it into or clearing the composer. Invocation transcripts remain read-only and do not become composer actions.

Dashboard replies may also request a short avatar reaction through `metadata.agentEffect`. Its exact required fields are `emotion`, `animation`, and `durationMs`; `caption` is optional. `emotion` supports `happy`, `sad`, `angry`, `sleepy`, `bored`, `curious`, `thinking`, `excited`, `surprised`, and `proud`. `animation` supports `hyped`, `shake_head`, `nod`, `laughing`, `wink`, and `dance`. `durationMs` must be a whole safe integer from 500 through 10000, inclusive. A caption is trimmed, must not be blank, and may contain at most 120 characters.

JSON-mode providers emit `agentEffect` beside `replyMarkdown`; MCP-native providers use a `codeux:agent` JSON fence. Valid native fences are removed from visible markdown and the first valid effect is persisted. Invalid top-level effects are omitted, while malformed or invalid native fences become ordinary visible JSON code blocks. Validation is all-or-nothing; fields are never partially coerced. At display time, valid metadata takes precedence over a valid legacy fence, with the fence used only when metadata is missing or invalid.

The cinematic stage applies a validated effect only to the latest Project Manager reply, identified by reply direction even when its author type is `system`, and only for its bounded duration. The precedence is runtime error, outgoing message routing, active selected-Project-Manager reply work, response effect, normal mood, then idle cue. Unrelated agent work stays a background thought/status cue and cannot select the Project Manager's expression, caption, thought bubble, or work tool. The reply markdown, widgets, timestamp, and Threads transcript remain unchanged. Reduced motion keeps the semantic emotion and caption as a static cue while skipping choreography. Avatar-only metadata is not included in external delivery payloads; valid fences are stripped and invalid fences are downgraded to readable JSON before an external reply is sent.

Assistant prose bubbles can also show a short italic project-manager thought below the provider text. The dashboard uses safe explicit metadata (`metadata.moodComment`, `metadata.thinkingLine`, or `metadata.pmAside`) when present, otherwise it chooses a deterministic line from the shared `mood` catalog. These asides are visual adjuncts only: they do not replace provider markdown, do not change stored chat contracts, and do not appear on user, system, tool, reasoning, tool-call, or tool-result cards.

All playful chat-agent copy is curated to stay workplace-safe and non-offensive. Status jokes, tool-call quips, reasoning/thinking lines, and assistant mood asides are decorative context around the transcript. They never replace the provider response, tool name, arguments, output, reasoning text, debug metadata, or persisted conversation content.

Reasoning, tool-call/tool-result, and planning cards share one frontend resolver contract across normal thread messages and invocation transcripts. Invocation records use their top-level tool payloads, while thread messages carry merged tool arguments and output inside `metadata.toolCallsJson`; no extra top-level field is added to stored conversation messages.

For integrators, the stored metadata uses `metadata.promptSuggestions` with `label`, `prompt`, and optional `icon` fields:

```json
{
  "promptSuggestions": [
    {
      "label": "Inspect worker logs",
      "prompt": "Inspect the latest worker logs and summarize any failing step.",
      "icon": "terminal"
    }
  ]
}
```

Supported generic icon identifiers are `sparkles`, `search`, `edit`, `code`, `terminal`, `bug`, `check`, `play`, `refresh`, `settings`, `file`, `folder`, `git-branch`, `git-pull-request`, `database`, `shield`, `book-open`, `message-circle`, `list-checks`, `rocket`, `zap`, `lightbulb`, `clipboard`, `download`, `upload`, `eye`, `package`, `server`, `clock`, and `help-circle`.

Normal thread messages can also render external work references as rich cards without changing the stored transcript. The dashboard recognizes Jira issues, GitHub issues and pull requests, and GitLab issues and merge requests from explicit message metadata first, then from JSON-looking message bodies with the same fields. Recognized cards show the provider, key or number, title, status, safe external link, repository or project path, labels, assignee or author, and a short preview. Malformed JSON or unsupported providers remain ordinary markdown instead of being dropped.

## Compacting a thread

Long threads accumulate context cost. Click **Compact** to:

1. Ask the assigned non-Jules CLI provider to run its native compact command inside the current provider session.
2. Store the provider's compaction output on the thread for audit and recovery.
3. Continue the conversation in the same compacted provider session with a smaller context, preserving that native session id on the thread when the provider returns one.

Code UX does not create a separate `:compaction` chat session for CLI providers. If a thread has no saved active session, providers with a logical continue/resume fallback can still compact through that same thread session; providers that require a concrete native session ask you to send a message in the thread before compacting.

## Invocations

The **Invocations** tab is a structured log of server-created execution invocations routed through this project:

- **Summary** — provider/model, purpose, status, and token usage when available.
- **Transcript** — prompt, assistant, reasoning, and tool messages captured for that invocation.
- **MCP activity** — tool name, arguments, response payload, invoking connection, or error when the invocation came from MCP.
- **Timing** — start, end, duration.
- **Linked task / sprint** — when an invocation arose from sprint orchestration.

Use this for debugging provider runs and MCP client integrations, for example to inspect agent transcripts or see exactly what arguments your LLM is passing to tools like `manage_memory` or `manage_settings`.

Invocation transcripts use the same live sprint status and sprint/task reference cards as thread messages when their references resolve to active-project records. This means a planning invocation and its related chat message should show consistent task progress without a separate refresh control. Completed sprint-planning invocations append a final assistant summary with `metadata.widget_metadata.type = "planning_request"`, `status = "completed"`, and `metadata.executionPlan` for that invocation's linked sprint, including the sprint id, created task ids, and planned task titles. The plan shown in the transcript is replayed from persisted invocation message metadata, not from the currently selected sprint or the latest planning run for the project, so historical planning transcripts remain sprint-specific and stable.

For Gemini CLI, Codex, Claude Code, Qwen Code, OpenCode, and Antigravity, reported tokens and parsed provider turns stream into running invocation details for planning, QA, dashboard chat and worker replies, project setup, memory remediation, CI and merge-conflict repair, task follow-up, and task coding. The detail view maps those turns into user, assistant, explicit readable reasoning, tool-call, tool-result, and injected-context messages. Live refreshes replace changed content or metadata without duplicating a transcript; caller-owned prompt, routing, retry, and audit messages remain visible. Malformed provider records are skipped without hiding neighboring valid records, and opaque or token-only reasoning is never shown as readable reasoning. When only final text is available, the completed invocation appends that assistant text instead of replacing the existing history. Jules continues to display its separately synchronized remote transcript and estimated usage rather than claiming local native token telemetry.

Gemini structured output contributes assistant, reasoning, tool-call, and tool-result cards when the CLI exposes those parts, while plain Gemini response strings remain final assistant text. Tool-call and reasoning transcript cards can include compact workplace-safe contextual lines, such as search or terminal quips for tool calls and a short thinking line for reasoning turns. These lines are adjunct UI only: the raw tool name, status, call id, provider timestamp, token count, arguments, output, and expandable reasoning text remain available for debugging in the transcript.

Claude Code and Qwen Code invocation transcripts are parsed from provider-native session/log artifacts into normalized user, assistant, reasoning, tool-call, tool-result, and injected-context turns. Parsers preserve the invocation start window, avoid synthesizing readable reasoning from token counts or opaque fields, and deduplicate repeated provider records when their native ids identify the same logical response.

Invocation transcripts use the same external-reference cards as thread messages for recognized Jira, GitHub, and GitLab payloads, including JSON payloads that would otherwise appear as raw punctuation-heavy output. This keeps linked work readable while preserving the original backend metadata and message content.

Planning and QA self-reflection messages appear as structured cards instead of raw system text. Each card shows whether the reflection passed, needed improvement, or hit an error; the final decision; the attempt number; and each criterion's 5-star rating, numeric score, threshold, rationale, and improvement instructions when available.

## Posting messages

The composer at the bottom supports:

- **Multi-line input** with Enter to send, Shift+Enter for newline.
- **Recent message recall** with ArrowUp and ArrowDown when native textarea cursor movement is not taking precedence.
- **Speech input** with the microphone beside Send in project Threads mode and in the avatar control dock in 3D Chat.
- **Slash commands** that invoke management actions inline.
- **Attachments** *(planned)*.

Use the microphone control to dictate into the current thread draft. When transcription succeeds, Code UX inserts the transcript at the current caret position when the composer selection is available; otherwise it appends the text to the end of the draft with normal spacing. The composer resizes after insertion, and you can edit the dictated text before pressing Enter or Send.

Speech input is available for project Threads and 3D Chat. It is disabled while a message is sending and is not shown in no-project assistant chat or invocation transcripts. If the browser cannot record audio, microphone permission is denied, the local speech model is missing, or the configured provider fails, the button reports the failure and leaves the draft unchanged so you can retry or type normally.

The active thread can be deleted from the **⋯** menu. Deletion is local (the underlying provider session is closed) and does not affect sprints or tasks. You can also cancel the currently running turn for a specific thread, which aborts only the matching in-flight thread turn.
