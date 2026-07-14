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

`useDashboardI18n` exposes `formatNumber`, `formatDate`, `formatTime`, `formatRelativeTime`, and `formatList`. Each function is rebound when the active locale changes and accepts the corresponding native `Intl` options. New localized UI should use these functions instead of adding fixed `en-US` formatters.

## Project management coverage

The Projects route owns `i18n/messages/projects.ts`. Its catalog covers the gallery, project cards, status filters, setup and deletion dialogs, notifications, directory browser, and both shared project-creation modals. Because `AddProjectModal` reads the root locale directly, the same translated form is used when it opens from the top navigation, Tasks, Sprints, or the dashboard assistant; those callers do not pass translated labels or alter their project payloads.

Project card timestamps, counts, and completion percentages use locale-bound `Intl` formatting. Project names, local paths, repository URLs and slugs, branches, provider names, application-kind contract values, setup payloads, and API/provider diagnostics remain verbatim. The internal filter and creation-mode identifiers also remain stable English contract values while only their labels are localized.

Project deletion uses a localized confirmation dialog before invoking the existing deletion request. Creation, setup, selection, Settings navigation, invocation tracking, duplicate-submit protection, and stale project-selection handling retain their existing contracts.

The Sprints route owns its catalog in `dashboard/src/v2/i18n/messages/sprints.ts`. The page header, gallery, ledger, menus, bulk actions, importers, rollback flow, status summaries, empty/error states, and ARIA announcements follow the active locale. Sprint and task records, linked issue keys/titles/content, provider names, Git/PR details, review output, runtime events, importer warnings, and API error messages are data rather than interface copy and remain verbatim. Dates, times, counts, percentages, and list summaries use the active locale without changing stored UTC timestamps or sort keys.

## Translation scope

The eager application bundle translates root-owned shell copy: the skip link, main landmark label, route loading announcement, and hidden footer. Localized routes import their own feature catalogs so route copy remains lazy-loaded. Browser Preview uses `messages/browser-preview.ts` for its page, browser chrome, session, environment, status, and accessibility copy.

Localization applies only to dashboard-authored interface copy. API responses, provider output, stored instructions, project and sprint data, runtime diagnostics, and all other user-authored content must remain unchanged.

### Agents route

The `/agents` route owns `messages/agents.ts`. Its English and German catalog covers roster controls, preset details and editing, validation, avatar controls, instruction files, memory filters, MCP access, repository push feedback, compatibility-update notices, empty/loading/error states, and accessible labels. Dates, counts, token estimates, file sizes, and plurals use the active locale's native formatters.

The localization boundary is intentionally strict. Preset names and labels, system instructions, memory templates, Markdown file contents, MCP server and tool names, storage names, provider/model names, invocation and repository output, and API error messages pass through verbatim. Stable configuration identifiers—such as avatar part values, memory tiers, MCP tool IDs, and sync states—also remain unchanged; only their dashboard presentation is localized.

## Overview route coverage

The Overview route owns `messages/overview.ts`. Its page header, landmarks, metric deck, source grid, active-stream list, controls, telemetry rail, live-region announcements, and empty/loading/error fallbacks switch together with the active locale. Overview presentation helpers receive locale-bound formatters for token totals, USD cost, durations, counts, percentages, sprint dates, and runtime times; they do not change timestamp parsing, list ordering, status precedence, polling, or realtime subscriptions.

Project, sprint, task, branch, repository, provider, and model values remain verbatim. The same boundary applies to server errors, attention titles and markdown, and runtime-authored execution text. Only dashboard-generated fallback labels and status summaries are translated.

Active-stream task rows localize their status labels and announcements, but the duration field always renders the runtime-provided task duration unchanged for pending, active, review, and completed tasks.

The lazy-loaded Stats route owns `messages/stats.ts` and binds that catalog to the root locale through a feature-level provider, so opening Stats does not pull its catalog into the entry bundle. Its modes, filters, charts, metric cards, analysis studios, ledgers, system tables, state feedback, and accessibility descriptions are available in English and German.

Stats also formats presentation values with the active locale. This covers numbers, USD currency, percentages, dates, times, durations, and pluralized counts. Custom-range controls keep locale-neutral `YYYY-MM-DD` query values while their visible range summary and application announcement use locale-formatted UTC dates. Date and time presentation remains explicitly UTC because telemetry buckets and custom-range queries use UTC boundaries; localization changes notation, not bucket membership, precision, ordering, chart geometry, or cost calculations. Provider/model/purpose identifiers, project/sprint/task names, Git refs, invocation messages, provider errors, server-supplied telemetry labels, and API errors remain verbatim.

The feature-gated custom-dashboard workspace owns its catalog in `messages/custom-dashboards.ts`. It localizes management, editor, viewer, validation, publication, and accessibility chrome. Persisted dashboard bundles and user-authored fields remain locale-neutral; known validation issue codes may select a localized explanation, while API, build, log, preview, and iframe diagnostics remain verbatim.

## Verification

Foundation coverage is in `tests/dashboard/v2/i18n-foundation.test.tsx`. It exercises startup defaults, stored German restoration, live switching, invalid and unavailable storage, cross-tab events, interpolation, plural rules, all formatter families, and HTML `lang` synchronization. Agents coverage additionally verifies German route chrome and validation while asserting that authored instructions, imported Markdown, server labels, and persisted configuration values are not translated. Stats-specific suites cover German presets and custom-range validation, localized presentation helpers, chart and accessibility states, analysis comparisons, ledgers, system filters, failure/retry behavior, responsive layouts, and stable telemetry calculations.
