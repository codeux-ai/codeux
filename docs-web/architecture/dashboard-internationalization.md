# Dashboard internationalization

The v2 dashboard includes a dependency-free internationalization foundation for English (`en`) and German (`de`). English is the compatibility default, and the dashboard does not infer a locale from browser preferences.

## Architecture

The runtime is isolated under `dashboard/src/v2/i18n/`:

- `locales.ts` defines the closed locale type, compile-time message-key parity, English fallback, literal variable interpolation, and `Intl.PluralRules` selection.
- `storage.ts` safely persists the locale under the versioned `codeux.dashboard.locale.v1` browser key.
- `formatters.ts` binds number, date, time, relative-time, and list formatting to the active locale.
- `context.tsx` provides locale state, synchronous switching, translated messages, cross-tab synchronization, and `<html lang>` updates.
- `messages/` contains feature-owned catalogs so lazy route bundles do not become part of an eager monolithic catalog.

Onboarding owns `messages/onboarding.ts`. Its catalog covers the full first-run flow, readiness and installation framing, provider setup, validation and save announcements, plus the responsive guided tour. Locale-explicit helpers localize reducer defaults and other pure presentation data without coupling settings drafts or persistence helpers to Preact context.

The provider restores storage and updates `document.documentElement.lang` before the application root renders. Missing, invalid, unavailable, or throwing storage safely resolves to English. Storage events from another tab update locale state immediately; clearing the key resets the dashboard to English.

## Adding a feature catalog

```ts
const messages = defineDashboardMessages({
  en: {
    greeting: "Hello, {name}!",
    itemCount: { one: "{count} item", other: "{count} items" },
  },
  de: {
    greeting: "Hallo, {name}!",
    itemCount: { one: "{count} Eintrag", other: "{count} Einträge" },
  },
});

const { translate, translatePlural, formatNumber } = useDashboardI18n();
```

English and German must declare exactly the same top-level keys. Interpolation treats replacement values as literal text, and plural messages require an `other` form. Plural selection receives the raw numeric count, while the reserved `{count}` token is number-formatted for the active locale; callers may provide a separately formatted `{count}` display value, which is preserved. Other locale-aware formatting also delegates to the browser's native `Intl` implementation.

 Keep each catalog with its owning feature and import it only where the feature is loaded. Translate dashboard-authored interface copy only. Never translate provider output, API responses, stored instructions, project data, runtime diagnostics, or user-authored content.

## Model and memory settings

AI Models and Memory settings use a feature-owned catalog for routing diagrams, provider and model controls, thinking modes, pricing, speech configuration, catalog filters, license confirmations, and remediation controls. Counts, byte sizes, percentages, token prices, and memory limits use the active locale while preserving USD and the existing per-million-token precision.

Speech and model contracts remain locale-neutral. Provider and model IDs, language tags, BCP-47 values, voice IDs, API-returned metadata, license and attribution text, endpoints, and runtime diagnostics are displayed unchanged. Choosing a recommended speech model only updates the settings draft; a model download starts only after the user accepts the localized license confirmation.
The Knowledge route is a concrete feature catalog: its headers, document controls and states, ingestion dialogs, search feedback, confirmations, and accessible announcements support English and German. Counts, sizes, dates, and similarity percentages follow the active locale, while document data, paths, names, identifiers, search excerpts, partial-failure diagnostics, and API errors remain verbatim.

The Integrations and MCP catalog localizes provider and chat-bridge setup, authentication and connection states, terminal-login controls, automation credentials, MCP categories, local CLI installation, clipboard feedback, and custom-server validation. Provider and product names, credential values, redacted placeholders, paths, endpoints, repository identifiers, tool and server names, scopes, transport literals, terminal streams, and server diagnostics remain verbatim and are never passed through translation interpolation.

The operational Settings catalog covers General, Sprint, QA, Automation, Worker, Browser, and Danger controls and their related dialogs. Localized option captions continue to save the existing enum values, while branch tokens, paths, command examples, default instruction templates, dependency metadata, API errors, and runtime diagnostics are displayed unchanged.

The Settings feature localizes each `SectionCard` title and its purpose summary, controlled-functions guidance, recommendation, and risk notes. Stable subcategory ids, English lookup aliases, documentation routes, provider names, technical values, and backend-facing data remain locale-neutral, and the linked long-form documentation remains English.

Sprint authoring uses `messages/sprint-authoring.ts` for Sprint Composer, sprint/task modals, Quicksprint, planning progress, Markdown transfer, and sprint settings-override chrome. Its boundary is intentionally presentation-only: sprint goals, task prompts, template Markdown, combined prompts, provider/model IDs, agent names, schedule targets, and settings keys and values pass through unchanged. The sprint settings editor localizes dashboard-authored card, row, and ARIA descriptions. Generated descriptions resolve known lowercased settings labels without applying case-insensitive translation to standalone or user-authored values.

## Nodes route

The feature-gated Nodes route imports its own `messages/nodes.ts` catalog. English and German cover its library, palettes, canvas and minimap controls, inspectors, governance review, validation summaries, run debugger, scheduling entry point, empty/error states, and accessible names. Locale-explicit helpers serve the pure node view models and dashboard-generated canvas and agent-command validation explanations.

This boundary is presentation-only: graph serialization, ids and types, schema keys, command names, configuration values, migration markers, skill names, API errors, policy/provider diagnostics, run logs, and execution payloads remain unchanged. Known status values are mapped to localized display text without changing the underlying contract value.

## Memory route boundary

The Memory route has a feature-owned English and German catalog covering map controls, tier and scope filters, search, cards, the inspector, add/delete and batch actions, accessible announcements, and the embedding-model catalog and custom-model form. Locale-aware `Intl` formatting handles counts, plurals, percentages, dates, strengths, and file sizes without changing numeric values or filter/sort behavior. Localized category labels can be searched while the persisted category keys remain stable.

The localization boundary deliberately excludes memory titles and content, claims, evidence, tags, agent names, model IDs, catalog descriptions, languages, licenses, URLs, filenames, and server/API diagnostics. Those values are rendered exactly as supplied.

## Agents route boundary

The lazy `/agents` route imports its own `messages/agents.ts` catalog. English and German cover the roster, preset detail/editor, validation, avatar customization, instruction files, memory and MCP configuration, repository push feedback, compatibility updates, loading and empty states, and accessibility labels. Dates, counts, token estimates, byte sizes, and plural messages use the active locale.

Agent-authored and runtime data stays byte-for-byte outside translation: preset names and labels, system instructions, memory templates, Markdown files, MCP server/tool names, storage names, provider/model names, repository and invocation output, and API errors. Persisted identifiers and configuration values are likewise unchanged; the route translates only their presentation.

## Settings localization boundaries

The Agents, Techstacks, and Guidance settings surfaces use `messages/settings-agents-guidance.ts`. Component copy follows the provider's active locale, while locale-explicit presentation helpers accept `en` or `de` for tests and non-component consumers.

Localization stops at the persistence boundary: agent and stack ids, preset and storage names, package labels, application-kind values, reflection criteria, memory/instruction markdown, and custom guidance remain byte-for-byte as authored. Persistent-skill storage creation, editing, deletion, and agent attachments still mutate immediately; changing locale does not move those operations into the Settings draft or bypass pending, confirmation, recovery, and focus-restoration behavior.

Chat uses the feature-owned `messages/chat.ts` catalog for its thread and invocation chrome, composers, quick actions, rich widgets, cinematic cues, speech controls, feedback, humor, and accessibility announcements. Pure Chat helpers accept an explicit locale, and mounted components bind to the provider locale. Time, relative-time, count, percentage, duration, token, and retry displays use native `Intl` formatting.

The boundary is intentionally strict: message bodies, prompts and quick-action request payloads, reasoning, tool names/arguments/output, invocation logs, scheduled instructions, provider errors, provider-authored runtime status values, entity names, and speech transcripts remain unchanged. Known dashboard-owned invocation status enums are localized in visible and accessible card text while unknown statuses retain their raw values; transcript headers localize structural role labels and preserve configured agent names. German tests assert both the translated frame and the verbatim payload.
Browser Preview is the first route-wide catalog. Its components use the active locale for copy, pluralized session/environment counts, and pending port summaries, while URLs, paths, commands, environment data, logs, names, ports, container identifiers, and server diagnostics remain literal runtime values.

For onboarding specifically, provider and dependency names, detected paths, model IDs, command snippets and installation output, and API-returned readiness diagnostics stay verbatim. The locale changes only dashboard-owned framing and accessible names; submitted provider IDs, enums, credentials, and settings drafts are unchanged.

The feature-gated custom-dashboard workspace owns its catalog in `messages/custom-dashboards.ts`. It localizes management, editor, viewer, validation, publication, and accessibility chrome. Persisted dashboard bundles and user-authored fields remain locale-neutral; known validation issue codes may select a localized explanation, while API, build, log, preview, and iframe diagnostics remain verbatim.

The Projects route owns `i18n/messages/projects.ts`. Its catalog covers the gallery, project cards, status filters, setup and deletion dialogs, notifications, directory browser, and both shared project-creation modals. Project card timestamps, counts, and completion percentages use locale-bound `Intl` formatting, while project names, local paths, repository URLs and slugs, branches, provider names, application-kind contract values, setup payloads, and API/provider diagnostics remain verbatim.

The Sprints route owns its catalog in `dashboard/src/v2/i18n/messages/sprints.ts`. The page header, gallery, ledger, menus, bulk actions, importers, rollback flow, status summaries, empty/error states, and ARIA announcements follow the active locale. Sprint and task records, linked issue keys/titles/content, provider names, Git/PR details, review output, runtime events, importer warnings, and API error messages remain verbatim; locale-aware formatting does not change stored UTC timestamps or sort keys.

The Settings shell owns `messages/settings-shell.ts`. Users choose **English** or **Deutsch** under **Settings → Appearance → Display Settings → Language**. The selection applies immediately in System and Project views, persists in browser-local storage, updates `<html lang>`, and does not participate in Settings dirty tracking or Save/Reset requests. It is dashboard-owned: runtime and API messages, stored instructions/configuration values, and the English documentation remain unchanged. Settings category ids and navigation persistence remain language-neutral so changing locale never invalidates the current category.

## Shell catalog and content boundaries

`messages/shell.ts` owns global navigation, title-bar controls, search, notification chrome, status presentations, documentation-viewer controls, and reusable control defaults. Navigation copy is keyed by stable item ID, allowing the sidebar, dock, top navigation, search, and experience-mode filtering to display the same locale-aware labels without changing paths or feature flags. Explicit component copy remains authoritative; translated defaults are used only when callers omit it.

Notifications translate only dashboard-authored chrome, fallback actions, relative times, severity labels, and field names. Server-authored titles, bodies, reasons, instructions, recommended actions, context values, and errors remain verbatim. Documentation routes translate their headings, search, pagination, menus, landmarks, and result counts, but fetched titles, descriptions, sections, source paths, and rendered Markdown remain English.

## Live route boundary

The lazy-loaded Live route owns `dashboard/src/v2/i18n/messages/live.ts`. Its catalog covers headers, filters, transport and reconnect notices, task controls, runtime and attention panels, timeline and DAG legends, boat-race labels, statistics, confirmations, empty states, and screen-reader summaries. Numbers, timestamps, durations, percentages, token totals, and plural counts use locale-aware formatters.

Live localization is presentation-only. Known sprint-run, dispatch, and task-run status enums resolve through the Live catalog, while unrecognized technical status values remain raw. Sprint, task, and project names; execution event messages; provider or agent output; Git branches; pull request and CI details; attention descriptions; terminal diagnostics; intervention titles, reasons, and instructions; and API errors remain verbatim. Locale-bound action callbacks update confirmations and retry controls immediately after a language change. Switching locale does not alter realtime subscriptions, runtime projection, status precedence, event ordering, or action endpoints.

## Automated completeness checks

`pnpm run check:dashboard-i18n` parses production dashboard TypeScript and TSX with the TypeScript compiler API. It reports literal JSX text, including single-word labels, user-facing attributes, and presentation metadata outside feature message bundles. `scripts/dashboard-i18n-allowlist.json` permits only an exact path, source line, candidate kind, and literal text with a rationale; line movement or copy changes force a fresh review. Exemptions are limited to verbatim documentation or license content, protocol and technical values, code/configuration examples, and runtime or user data.

`tests/dashboard/v2/i18n-catalog-parity.test.ts` maintains the required feature-catalog manifest, enumerates the message directory, and fails when a required catalog is missing or a discovered catalog is not imported. Every registered bundle is checked for English/German keys, message shapes, placeholders, supported plural categories, non-empty composed messages, and accidental HTML. `tests/dashboard/v2/i18n-runtime-boundary.test.tsx` verifies that translated framing and locale formatting do not rewrite provider messages, English docs Markdown, or project, sprint, task, and chat content.

The Playwright fan-in at `tests/e2e/navigation/dashboard-i18n.spec.ts` selects Deutsch through Settings → Appearance, verifies immediate and persisted `<html lang="de">`, visits every registered production route and the not-found route, and checks German shell landmarks, keyboard interaction, dialogs, listboxes, focus restoration, live announcements, responsive containment, locale-formatted values, browser errors, and unchanged fixture content. Nodes and Custom Dashboards remain covered by their deterministic German component and route tests when their production feature flags are disabled.
