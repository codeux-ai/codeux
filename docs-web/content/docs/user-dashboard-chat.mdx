# Chat

The **Chat** page (`/chat`) is a thread-based conversation surface that lets you talk to agents for project-backed Q&A, inspect execution invocation transcripts and MCP tool invocations, and get local onboarding help before any project exists.

## Layout

- **No-project assistant** — When no project is selected, `/chat` shows a local onboarding assistant instead of a project-required empty state. It presents the Code UX assistant avatar, five quick bubbles, local replies, and explicit buttons for Add Project, Projects, Settings, onboarding, and docs. It does not create conversation threads, persist messages, or call project-scoped chat APIs.
- **Floating assistant widget** — Every dashboard subpage except `/chat` has a compact assistant entry point in the corner. Submitting text opens `/chat` with that text as a draft. If a project is selected, the draft appears in the normal composer; if no project is selected, it becomes a local no-project assistant turn. Nothing is sent automatically.
- **Left rail** — In project chat, two tabs:
  - **Threads** — Conversation threads scoped to the active project.
  - **Invocations** — A historical log of server-created execution invocations, including provider-backed agent runs and MCP `CallTool` activity.
- **Main panel** — The active thread (or invocation), rendered as a chat transcript with user, assistant, and tool messages. Markdown is rendered with `marked`, including code blocks.

The floating widget uses the configured Dashboard Reply agent avatar when a selected project has one. If no Dashboard Reply preset or project is available, it falls back to the generated Code UX avatar.

3D chat and agent avatar surfaces use the standard WebGL avatar with studio lighting and pointer-aware head movement. The removed flashlight beam, target glow, low-battery flicker, and emissive shell boost are no longer part of the chat layout; reduced-motion settings or WebGL fallback mode continue to use the static SVG avatar.

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

The project chat composer saves your latest draft in SQLite per dashboard user, project, and active chat context, and also mirrors the active typed text to browser-local storage immediately so a page refresh cannot lose recent keystrokes while the backend write is still pending. Leaving `/chat`, switching away and back, or reloading restores the matching draft for the current new-thread composer or selected thread without reusing drafts from another project or browser user. Blank drafts are recorded as empty locally and remove the saved row, and sending still clears the composer after the message is accepted.

The composer also keeps a recent-message history for successful project chat sends. Press ArrowUp or ArrowDown while composing to preview messages submitted by the current dashboard user in the current project; a fresh dashboard user starts with no recalled messages. Single-line drafts can recall history directly, while multi-line drafts keep normal textarea cursor movement unless the caret is at the true start or end. Code UX preserves the current draft while you cycle through history and restores it when you move back past the newest recalled entry.

## Create app quickactions

Use **Create Web App** or **Create Desktop App** when you want Code UX to start an app-building sprint in the selected project from chat. In Threads mode, the buttons sit beside the composer and are also available in an empty thread. In 3D Chat, the idle Web App and Desktop App quickactions send the same kind of request through the active thread.

Clicking either quickaction starts immediately. You do not need to type composer text first, and Code UX does not show a confirmation step. If there is no active thread yet, the dashboard creates one, posts a short visible message such as `Create a web app`, and starts the matching quicksprint in detached `Plan & Start` mode while you stay in Chat.

The quickaction carries the active project's effective techstack into planning: the selected catalog entry when assigned, or the catalog default when the project is unassigned. Stack item labels become suggestion tags, so the progress widget and planner begin from the same stack context visible in the dashboard.

The transcript then shows an app progress widget instead of raw status data. The widget reports:

- whether the sprint is for a web app or desktop app
- the app sprint name
- selected stack details such as framework, runtime, package manager, styling, and tests when available
- planning stages from Planning through Plan, Showing each Task, Start, and Finish
- suggestion tags that can guide your next message

You can keep sending messages in the same thread while planning runs. If the planner has not created tasks yet, Code UX queues those follow-ups and applies them to the sprint when planning finishes. Once tasks exist, follow-ups update the sprint direction immediately and the thread confirms the update. The added direction appears on the sprint goal under `Additional direction from chat`; generated task prompts are not rewritten by those follow-ups. Non-app quickactions still use the normal routed chat reply path.
After you send a message, the thread transcript updates from the server's returned chat message. The **Invocations** rail updates separately from persisted server invocation records and realtime refreshes, so it shows only backend-confirmed invocation rows. The dashboard no longer inserts a frontend-only optimistic invocation placeholder while the backend is still creating the real row.

While a reply or invocation container is active, the visible status line uses light deterministic humor instead of static `Initializing` or `Working` copy. These messages are keyed by the active agent, provider/model, and phase, and they remain stable for at least five seconds so live regions do not churn during rapid refreshes. The funny line is a UI adjunct only; it does not replace the actual agent reply, invocation status, or stored transcript.

In 3D Chat, idle quick actions send project-scoped prompts directly through the active thread. **Web App** and **Desktop App** set up the currently selected project using its current techstack setting; an unassigned existing project stays `None`. They do not create or import a new Code UX project.

Planning messages can include a rich sprint status card. When Code UX can match the message to loaded live project data, the card is backed by the current task records and execution snapshot, so it updates as tasks move from queued to running, completed, failed, blocked, or quota-waiting. It shows the sprint key/name, request/task/run materialization, overall progress such as `0/7 · 0%`, queued task count, and a compact task list. If either task records or the execution snapshot are still loading, the chat keeps the generic planning status card until both live records are available for the active project.

Threads also surface the same rich reasoning, tool activity, and planning cards that were previously only visible in the Invocations transcript. Code UX selects these cards from message metadata, so reasoning turns, planning request messages, and paired tool calls/results appear inline in the normal conversation instead of falling back to raw transcript text. Matching tool-call and tool-result messages are paired by their metadata call id and shown as one activity card.

Chat messages and invocation transcripts can also turn sprint and task references into live cards when they match real records in the active project. Sprint cards show the sprint status and completion progress, then link to the matching Sprint page. Task cards show the task status, priority, executor, and sprint context, then link to the matching Tasks page. Code UX only enriches references it can resolve in the active project; stale references stay as normal text, and ambiguous task keys are not guessed. Dashboard links can be relative `/sprints` or `/tasks` links, or absolute links on the current dashboard origin; external-origin links are left as normal transcript text. The cards refresh through the existing project-structure updates used by the dashboard, not through a separate chat stream.

Virtual chat replies can persist structured prompt suggestions for quick next steps. JSON-mode providers may return optional `suggestions` alongside `replyMarkdown` and `action`; Code UX stores valid entries on the assistant/system message as `metadata.promptSuggestions` after trimming strings, dropping malformed entries, and capping the list at six. Suggestions appear as clickable tags below the normal markdown reply, so the transcript remains visible. Clicking a tag sends that prompt immediately without inserting it into or clearing the composer. Invocation transcripts remain read-only and do not become composer actions.

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
- **Speech input** with the microphone control beside Send in project Threads mode.
- **Slash commands** that invoke management actions inline.
- **Attachments** *(planned)*.

Use the microphone control to dictate into the current thread draft. When transcription succeeds, Code UX inserts the transcript at the current caret position when the composer selection is available; otherwise it appends the text to the end of the draft with normal spacing. The composer resizes after insertion, and you can edit the dictated text before pressing Enter or Send.

Speech input is only available for project thread composers. It is disabled while a message is sending and is not shown in no-project assistant chat or invocation transcripts. If the browser cannot record audio, microphone permission is denied, the local speech model is missing, or the configured provider fails, the button reports the failure and leaves the draft unchanged so you can retry or type normally.

The active thread can be deleted from the **⋯** menu. Deletion is local (the underlying provider session is closed) and does not affect sprints or tasks. You can also cancel the currently running turn for a specific thread, which aborts only the matching in-flight thread turn.
