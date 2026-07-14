# Dashboard Internationalization

The v2 dashboard has a dependency-free internationalization runtime for English (`en`) and German (`de`). English remains the compatibility default. The runtime does not infer a language from the browser and does not change backend settings or API contracts.

## Runtime boundary

The runtime lives in `dashboard/src/v2/i18n/`:

| Module | Responsibility |
| --- | --- |
| `locales.ts` | Closed locale contract, typed message bundles, interpolation, English fallback, and plural selection |
| `storage.ts` | Safe browser-local persistence under `codeux.dashboard.locale.v1` |
| `formatters.ts` | Locale-bound `Intl` number, date, time, relative-time, and list formatters |
| `context.tsx` | Root provider, locale hook, document language synchronization, and cross-tab updates |
| `messages/` | Feature-owned catalogs imported by their consumers |

`DashboardI18nProvider` wraps the router at the application root. Its `setLocale` function updates context, persistence, and `document.documentElement.lang` immediately. Startup reads the stored locale and synchronizes the document before the first application render, preventing English shell content from rendering when German was already selected.

Missing, invalid, unavailable, or throwing `localStorage` falls back to English. A matching cross-tab `storage` event updates the mounted application without writing the value back. Clearing browser storage also resets the active locale to English.

## Feature-owned messages

Catalogs stay with their feature instead of being combined into an eagerly loaded application catalog. `defineDashboardMessages` requires the English and German catalogs to have the same keys at compile time and preserves those keys for typed translation calls.

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

const { translate, translatePlural } = useDashboardI18n();
translate(messages, "greeting", { name: "Sam" });
translatePlural(messages, "itemCount", 2);
```

Interpolation replaces only named `{variable}` tokens through literal string substitution. Missing variables remain visible, and values are never evaluated or inserted as HTML. Plural selection uses `Intl.PluralRules` for the active locale and falls back to the required `other` form.

## Locale-aware formatting

`useDashboardI18n` exposes `formatNumber`, `formatDate`, `formatTime`, `formatRelativeTime`, and `formatList`. Each function is rebound when the active locale changes and accepts the corresponding native `Intl` options. New localized UI should use these functions instead of adding fixed `en-US` formatters. Plural selection still receives the numeric count for threshold decisions, while an explicitly supplied formatted `count` variable is preserved for display (for example, German `1.000 Einträge`).

## Project management coverage

The Projects route owns `i18n/messages/projects.ts`. Its catalog covers the gallery, project cards, status filters, setup and deletion dialogs, notifications, directory browser, and both shared project-creation modals. Because `AddProjectModal` reads the root locale directly, the same translated form is used when it opens from the top navigation, Tasks, Sprints, or the dashboard assistant; those callers do not pass translated labels or alter their project payloads.

Project card timestamps, counts, and completion percentages use locale-bound `Intl` formatting. Project names, local paths, repository URLs and slugs, branches, provider names, application-kind contract values, setup payloads, and API/provider diagnostics remain verbatim. The internal filter and creation-mode identifiers also remain stable English contract values while only their labels are localized.

Project deletion uses a localized confirmation dialog before invoking the existing deletion request. Creation, setup, selection, Settings navigation, invocation tracking, duplicate-submit protection, and stale project-selection handling retain their existing contracts.

The Sprints route owns its catalog in `dashboard/src/v2/i18n/messages/sprints.ts`. The page header, gallery, ledger, menus, bulk actions, importers, rollback flow, status summaries, empty/error states, and ARIA announcements follow the active locale. Sprint and task records, linked issue keys/titles/content, provider names, Git/PR details, review output, runtime events, importer warnings, and API error messages are data rather than interface copy and remain verbatim. Dates, times, counts, percentages, and list summaries use the active locale without changing stored UTC timestamps or sort keys.

## Translation scope

The root bundle translates root-owned shell copy, while route-specific catalogs load with their features. The Settings shell owns `messages/settings-shell.ts`, which covers Settings navigation, Smart Find, scope and save feedback, shared field/status language, section help, and the Appearance controls.

Users choose **English** or **Deutsch** under **Settings → Appearance → Display Settings → Language**. The selection applies immediately in System and Project views, persists in browser-local storage, updates the document `lang`, and does not participate in Settings dirty tracking or Save/Reset requests. It is intentionally dashboard-owned: runtime and API messages, stored instructions/configuration values, and the English documentation are not translated.

Every Settings `SectionCard` uses the active dashboard locale for its visible title, purpose summary, controlled-functions guidance, recommended configuration, and risk notes. Subcategory ids, English lookup aliases, `/docs/settings-<subcategory>` destinations, related-document metadata, and backend-facing values stay locale-neutral; the linked long-form documentation remains English.

Localization applies only to dashboard-authored interface copy. API responses, provider output, stored instructions, project and sprint data, runtime diagnostics, and all other user-authored content must remain unchanged. Settings category ids and navigation persistence also remain language-neutral so changing locale never invalidates the current category.

The root bundle owns shell copy, while route catalogs are imported with their features. Chat owns `messages/chat.ts`, which covers page and thread chrome, composers, quick actions, invocation metadata labels, rich-widget frames, cinematic activity, speech controls, empty/error/confirmation feedback, humor, and accessible announcements. Pure Chat presentation helpers accept an explicit locale so tests and non-component consumers use the same catalog as mounted components.
The eager application bundle translates root-owned shell copy: the skip link, main landmark label, route loading announcement, and hidden footer. Localized routes import their own feature catalogs so route copy remains lazy-loaded. Browser Preview uses `messages/browser-preview.ts` for its page, browser chrome, session, environment, status, and accessibility copy.
Global navigation, title-bar controls, search, notifications, documentation-viewer chrome, status presentations, and reusable control defaults use the `messages/shell.ts` catalog. Navigation labels are resolved from stable navigation item IDs for each surface, so the sidebar, dock, top navigation, search, tooltips, and experience-mode filters share translated labels without changing routes, feature flags, or persisted IDs.

Reusable controls use the provider locale when mounted in the dashboard and retain an English compatibility fallback when rendered independently. Explicit caller-provided labels, placeholders, and helper text always take precedence over translated defaults. Locale changes update the mounted controls in place and do not reset their local interaction state.

Localization applies only to dashboard-authored interface copy. Chat message bodies, prompts, quick-action request payloads, reasoning, tool names and arguments/output, provider transcripts and errors, provider-authored runtime status values, scheduled instructions, entity names, and speech transcripts remain byte-for-byte display data. Known dashboard-owned invocation status enums are rendered through the Chat catalog in visible and accessible card text without changing their stored values; unknown statuses remain unchanged. Invocation transcript headers likewise localize structural role labels while preserving configured agent names. Localized labels may surround verbatim provider values, but must never rewrite them.

Chat uses the locale-bound `Intl` formatters for timestamps, relative time, counts, percentages, token estimates, durations, and retry timestamps. Deterministic humor keeps the same seed, deck, and cadence across locales; locale only selects the message catalog.
Notification panels translate their chrome, severity labels, relative times, and dashboard-generated recovery labels. Server-authored notification titles, summaries, reasons, instructions, context values, recommended actions, and error text are rendered verbatim. The documentation viewer similarly translates route headings, search, navigation, pagination, landmarks, and counts while keeping fetched document titles, descriptions, section names, source paths, and Markdown bodies in English.

The application shell and Memory route have feature-owned English and German catalogs. The Memory catalog covers the map, tier and scope filters, search, cards, inspector, add and delete flows, batch actions, empty/loading/error states, accessible announcements, and the embedding-model catalog and custom-model form. Counts, percentages, dates, strengths, file sizes, and plural forms use the active locale without changing their underlying numeric values or sort/filter behavior.
The eager application bundle translates root-owned shell copy: the skip link, main landmark label, route loading announcement, and hidden footer. Localized routes import their own feature catalogs so route copy remains lazy-loaded. Browser Preview uses `messages/browser-preview.ts` for its page, browser chrome, session, environment, status, and accessibility copy.

The application shell and File Browser are localized. The File Browser owns `messages/file-browser.ts` and translates page, session, file tree, changes, viewer, diff, loading, recovery, Monaco loading, and accessibility chrome. Counts and the displayed snapshot timestamp use the active locale's `Intl` formatters.

Localization applies only to dashboard-authored interface copy. API responses, provider output, stored instructions, project and sprint data, runtime diagnostics, and all other user-authored content must remain unchanged.

Operational Settings categories use a feature-owned catalog for General, Sprint, QA, Automation, Worker, Browser, and Danger controls plus their branch, PR-template, file-picker, and open-source dialogs. Translated captions map back to the existing serialized enum values; branch tokens, paths, command examples, default instruction templates, dependency metadata, API errors, and runtime diagnostics remain verbatim.
Memory category labels participate in localized text search, but their stored category keys remain unchanged. The route imports its catalog with the feature rather than adding it to the eager shell bundle.

Localization applies only to dashboard-authored interface copy. Memory titles and content, claims, evidence, tags, agent names, model IDs, catalog descriptions, languages, licenses, URLs, filenames, server errors, API responses, provider output, stored instructions, and project or sprint data remain unchanged.

### Agents route

The `/agents` route owns `messages/agents.ts`. Its English and German catalog covers roster controls, preset details and editing, validation, avatar controls, instruction files, memory filters, MCP access, repository push feedback, compatibility-update notices, empty/loading/error states, and accessible labels. Dates, counts, token estimates, file sizes, and plurals use the active locale's native formatters.

The localization boundary is intentionally strict. Preset names and labels, system instructions, memory templates, Markdown file contents, MCP server and tool names, storage names, provider/model names, invocation and repository output, and API error messages pass through verbatim. Stable configuration identifiers—such as avatar part values, memory tiers, MCP tool IDs, and sync states—also remain unchanged; only their dashboard presentation is localized.

## Overview route coverage

### Tasks route

The Tasks route owns its catalog in `dashboard/src/v2/i18n/messages/tasks.ts`. The page, board columns and filters, cards, dependency indicators, composer validation, rerun and delete flows, review surfaces, controller announcements, and task-specific accessibility copy all consume this feature catalog. Pure task view-model helpers accept an explicit locale so they remain deterministic outside component rendering, while components use the active provider locale.

Task counts, dates, relative times, live durations, self-reflection scores, and other numeric presentation use the active locale. Locale is presentation input only: task keys, titles, descriptions, Markdown prompts, sprint and project names, branch and pull-request data, provider and agent names, review and QA text, execution messages, API errors, dependency order, optimistic ids, and runtime projections remain byte-for-byte application data rather than translation input.

Task sprint dates are formatted from the sprint record's raw `startDate` and `endDate`; the compatibility `Sprint.date` projection is not a presentation source. Missing or invalid raw dates use the localized undated fallback. Likewise, only the closed set of dashboard-derived task-time sentinels (`Done`, `Review`, `Active`, `--`, and the optimistic `...`) is localized. Any other task-time or runtime value is shown verbatim.

Task surfaces that are rendered independently in component tests or embedded legacy call sites use `useOptionalDashboardI18n`. It has the same typed formatter and translator contract as the required hook and resolves to English only when no provider is mounted; it never replaces an active provider locale.

The feature-gated custom-dashboard workspace owns its catalog in `messages/custom-dashboards.ts`. It localizes management, editor, viewer, validation, publication, and accessibility chrome. Persisted dashboard bundles and user-authored fields remain locale-neutral; known validation issue codes may select a localized explanation, while API, build, log, preview, and iframe diagnostics remain verbatim.

The feature-gated Nodes route owns `messages/nodes.ts`. Its page shell, flow library, palettes, both canvas presentations, inspectors, governance review, debugger, scheduling entry point, generated validation explanations, and accessible names switch with the dashboard locale. Pure node view models and dashboard-owned canvas/agent validators accept an explicit locale and default to English for compatibility.

Node localization is presentation-only. Graph JSON, node and edge identities, node types, schema and widget keys, command names, configuration values, migration markers, skill names, API errors, policy/provider diagnostics, run logs, and provider input/output are never rewritten. Known runtime states are translated only while rendering; their contract values remain unchanged.

## Verification

Foundation coverage is in `tests/dashboard/v2/i18n-foundation.test.tsx`. Memory route coverage lives with the page, filter, search, list, inspector, batch-delete, model-browser, and model-card tests. Together they exercise German controls and announcements while asserting persisted knowledge, catalog metadata, identifiers, and API diagnostics remain verbatim.
Foundation coverage is in `tests/dashboard/v2/i18n-foundation.test.tsx`. It exercises startup defaults, stored German restoration, live switching, invalid and unavailable storage, cross-tab events, interpolation, plural rules, all formatter families, and HTML `lang` synchronization. Agents coverage additionally verifies German route chrome and validation while asserting that authored instructions, imported Markdown, server labels, and persisted configuration values are not translated. Overview, project, sprint, browser preview, custom dashboard, Nodes, onboarding, and Settings coverage verifies localized dashboard copy while preserving runtime data and backend-facing values.
Foundation coverage is in `tests/dashboard/v2/i18n-foundation.test.tsx`. Chat boundary coverage is in `tests/dashboard/v2/chat-i18n.test.tsx` and the focused Chat, widget, cinematic, speech, thread, and accessibility suites. These tests verify German controls and announcements while asserting that provider/runtime payloads and fixed quick-action prompts are unchanged.
Foundation coverage is in `tests/dashboard/v2/i18n-foundation.test.tsx`. It exercises startup defaults, stored German restoration, live switching, invalid and unavailable storage, cross-tab events, interpolation, plural rules, all formatter families, and HTML `lang` synchronization. Task-focused component, view-model, controller, dependency, review, rerun, and page tests additionally verify German CRUD presentation while persisted and runtime content remains unchanged.
Foundation coverage is in `tests/dashboard/v2/i18n-foundation.test.tsx`. File Browser coverage lives in `tests/dashboard/v2/file-browser-page.test.tsx`, `tests/dashboard/v2/components/file-browser.test.tsx`, the colocated File Browser regression suite, and `tests/e2e/projects/file-browser.spec.ts`. Together they cover German sessions and controls, locale-aware summaries, repository-data preservation, keyboard/accessibility behavior, stale data, failures, binary files, diffs, long paths, and responsive containment.
Foundation coverage is in `tests/dashboard/v2/i18n-foundation.test.tsx`. Memory route coverage lives with the page, filter, search, list, inspector, batch-delete, model-browser, and model-card tests. Together they exercise German controls and announcements while asserting persisted knowledge, catalog metadata, identifiers, and API diagnostics remain verbatim.
Foundation coverage is in `tests/dashboard/v2/i18n-foundation.test.tsx`. It exercises startup defaults, stored German restoration, live switching without control remounts, invalid and unavailable storage, cross-tab events, interpolation, plural rules, all formatter families, and HTML `lang` synchronization. Focused navigation, notification, title-bar, documentation-viewer, shared-control, Memory, and Agents tests cover the shell boundaries, German route chrome, and English-content exceptions. Agents coverage additionally verifies that authored instructions, imported Markdown, server labels, and persisted configuration values are not translated.
