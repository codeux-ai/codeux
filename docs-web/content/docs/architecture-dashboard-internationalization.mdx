# Dashboard internationalization

The v2 dashboard includes a dependency-free internationalization foundation for English (`en`) and German (`de`). English is the compatibility default, and the dashboard does not infer a locale from browser preferences.

## Architecture

The runtime is isolated under `dashboard/src/v2/i18n/`:

- `locales.ts` defines the closed locale type, compile-time message-key parity, English fallback, literal variable interpolation, and `Intl.PluralRules` selection.
- `storage.ts` safely persists the locale under the versioned `codeux.dashboard.locale.v1` browser key.
- `formatters.ts` binds number, date, time, relative-time, and list formatting to the active locale.
- `context.tsx` provides locale state, synchronous switching, translated messages, cross-tab synchronization, and `<html lang>` updates.
- `messages/` contains feature-owned catalogs so lazy route bundles do not become part of an eager monolithic catalog.

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

English and German must declare exactly the same top-level keys. Interpolation treats replacement values as literal text, plural messages require an `other` form, and locale-aware formatting delegates to the browser's native `Intl` implementation. Plural selection keeps using the numeric count while callers may provide a separately formatted `{count}` display value.

Keep each catalog with its owning feature and import it only where the feature is loaded. Translate dashboard-authored interface copy only. Never translate provider output, API responses, stored instructions, project data, runtime diagnostics, or user-authored content.

## Live route boundary

The lazy-loaded Live route owns `dashboard/src/v2/i18n/messages/live.ts`. Its catalog covers headers, filters, transport and reconnect notices, task controls, runtime and attention panels, timeline and DAG legends, boat-race labels, statistics, confirmations, empty states, and screen-reader summaries. Numbers, timestamps, durations, percentages, token totals, and plural counts use locale-aware formatters.

Live localization is presentation-only. Known sprint-run, dispatch, and task-run status enums resolve through the Live catalog, while unrecognized technical status values remain raw. Sprint, task, and project names; execution event messages; provider or agent output; Git branches; pull request and CI details; attention descriptions; terminal diagnostics; intervention titles, reasons, and instructions; and API errors remain verbatim. Locale-bound action callbacks update confirmations and retry controls immediately after a language change. Switching locale does not alter realtime subscriptions, runtime projection, status precedence, event ordering, or action endpoints.
