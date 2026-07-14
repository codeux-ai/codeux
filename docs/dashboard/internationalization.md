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

Interpolation replaces only named `{variable}` tokens through literal string substitution. Missing variables remain visible, and values are never evaluated or inserted as HTML. Plural selection uses the raw count with `Intl.PluralRules` for the active locale, while the reserved `{count}` interpolation is formatted with that locale's `Intl.NumberFormat`; the selected message falls back to the required `other` form.

## Locale-aware formatting

`useDashboardI18n` exposes `formatNumber`, `formatDate`, `formatTime`, `formatRelativeTime`, and `formatList`. Each function is rebound when the active locale changes and accepts the corresponding native `Intl` options. New localized UI should use these functions instead of adding fixed `en-US` formatters. Plural selection still receives the numeric count for threshold decisions, while an explicitly supplied formatted `count` variable is preserved for display (for example, German `1.000 Einträge`).

## Project management coverage

The Projects route owns `i18n/messages/projects.ts`. Its catalog covers the gallery, project cards, status filters, setup and deletion dialogs, notifications, directory browser, and both shared project-creation modals. Because `AddProjectModal` reads the root locale directly, the same translated form is used when it opens from the top navigation, Tasks, Sprints, or the dashboard assistant; those callers do not pass translated labels or alter their project payloads.

Project card timestamps, counts, and completion percentages use locale-bound `Intl` formatting. Project names, local paths, repository URLs and slugs, branches, provider names, application-kind contract values, setup payloads, and API/provider diagnostics remain verbatim. The internal filter and creation-mode identifiers also remain stable English contract values while only their labels are localized.

Project deletion uses a localized confirmation dialog before invoking the existing deletion request. Creation, setup, selection, Settings navigation, invocation tracking, duplicate-submit protection, and stale project-selection handling retain their existing contracts.

The Sprints route owns its catalog in `dashboard/src/v2/i18n/messages/sprints.ts`. The page header, gallery, ledger, menus, bulk actions, importers, rollback flow, status summaries, empty/error states, and ARIA announcements follow the active locale. Sprint and task records, linked issue keys/titles/content, provider names, Git/PR details, review output, runtime events, importer warnings, and API error messages are data rather than interface copy and remain verbatim. Dates, times, counts, percentages, and list summaries use the active locale without changing stored UTC timestamps or sort keys.

## Translation scope

The root bundle owns shell copy, while route catalogs are imported with their features. Chat owns `messages/chat.ts`, which covers page and thread chrome, composers, quick actions, invocation metadata labels, rich-widget frames, cinematic activity, speech controls, empty/error/confirmation feedback, humor, and accessible announcements. Pure Chat presentation helpers accept an explicit locale so tests and non-component consumers use the same catalog as mounted components.
The eager application bundle translates root-owned shell copy: the skip link, main landmark label, route loading announcement, and hidden footer. Localized routes import their own feature catalogs so route copy remains lazy-loaded. Browser Preview uses `messages/browser-preview.ts` for its page, browser chrome, session, environment, status, and accessibility copy.

Localization applies only to dashboard-authored interface copy. Chat message bodies, prompts, quick-action request payloads, reasoning, tool names and arguments/output, provider transcripts and errors, provider-authored runtime status values, scheduled instructions, entity names, and speech transcripts remain byte-for-byte display data. Known dashboard-owned invocation status enums are rendered through the Chat catalog in visible and accessible card text without changing their stored values; unknown statuses remain unchanged. Invocation transcript headers likewise localize structural role labels while preserving configured agent names. Localized labels may surround verbatim provider values, but must never rewrite them.

Chat uses the locale-bound `Intl` formatters for timestamps, relative time, counts, percentages, token estimates, durations, and retry timestamps. Deterministic humor keeps the same seed, deck, and cadence across locales; locale only selects the message catalog.

### Tasks route

The Tasks route owns its catalog in `dashboard/src/v2/i18n/messages/tasks.ts`. The page, board columns and filters, cards, dependency indicators, composer validation, rerun and delete flows, review surfaces, controller announcements, and task-specific accessibility copy all consume this feature catalog. Pure task view-model helpers accept an explicit locale so they remain deterministic outside component rendering, while components use the active provider locale.

Task counts, dates, relative times, live durations, self-reflection scores, and other numeric presentation use the active locale. Locale is presentation input only: task keys, titles, descriptions, Markdown prompts, sprint and project names, branch and pull-request data, provider and agent names, review and QA text, execution messages, API errors, dependency order, optimistic ids, and runtime projections remain byte-for-byte application data rather than translation input.

Task sprint dates are formatted from the sprint record's raw `startDate` and `endDate`; the compatibility `Sprint.date` projection is not a presentation source. Missing or invalid raw dates use the localized undated fallback. Likewise, only the closed set of dashboard-derived task-time sentinels (`Done`, `Review`, `Active`, `--`, and the optimistic `...`) is localized. Any other task-time or runtime value is shown verbatim.

Task surfaces that are rendered independently in component tests or embedded legacy call sites use `useOptionalDashboardI18n`. It has the same typed formatter and translator contract as the required hook and resolves to English only when no provider is mounted; it never replaces an active provider locale.

The feature-gated custom-dashboard workspace owns its catalog in `messages/custom-dashboards.ts`. It localizes management, editor, viewer, validation, publication, and accessibility chrome. Persisted dashboard bundles and user-authored fields remain locale-neutral; known validation issue codes may select a localized explanation, while API, build, log, preview, and iframe diagnostics remain verbatim.

## Verification

Foundation coverage is in `tests/dashboard/v2/i18n-foundation.test.tsx`. Chat boundary coverage is in `tests/dashboard/v2/chat-i18n.test.tsx` and the focused Chat, widget, cinematic, speech, thread, and accessibility suites. These tests verify German controls and announcements while asserting that provider/runtime payloads and fixed quick-action prompts are unchanged.
Foundation coverage is in `tests/dashboard/v2/i18n-foundation.test.tsx`. It exercises startup defaults, stored German restoration, live switching, invalid and unavailable storage, cross-tab events, interpolation, plural rules, all formatter families, and HTML `lang` synchronization. Task-focused component, view-model, controller, dependency, review, rerun, and page tests additionally verify German CRUD presentation while persisted and runtime content remains unchanged.
