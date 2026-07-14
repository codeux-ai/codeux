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

Interpolation replaces only named `{variable}` tokens through literal string substitution. Missing variables remain visible, and values are never evaluated or inserted as HTML. Plural selection uses the numeric count with `Intl.PluralRules` for the active locale and falls back to the required `other` form; callers may separately provide a locale-formatted `{count}` display value.

## Locale-aware formatting

`useDashboardI18n` exposes `formatNumber`, `formatDate`, `formatTime`, `formatRelativeTime`, and `formatList`. Each function is rebound when the active locale changes and accepts the corresponding native `Intl` options. New localized UI should use these functions instead of adding fixed `en-US` formatters.

## Translation scope

The initial application bundle translates only root-owned shell copy: the skip link, main landmark label, route loading announcement, and hidden footer. Route catalogs should be imported with their route when those features are localized.

Localization applies only to dashboard-authored interface copy. API responses, provider output, stored instructions, project and sprint data, runtime diagnostics, and all other user-authored content must remain unchanged.

### Live route

The lazy-loaded Live route owns `dashboard/src/v2/i18n/messages/live.ts`. It translates route headers, transport and stale-state notices, filters, task controls, runtime panels, attention actions, timeline and DAG legends, boat-race labels, statistics, empty states, confirmations, and screen-reader summaries. Live presentation helpers accept an explicit locale when they run outside a component; component consumers bind the same catalog to the provider locale.

Numbers, timestamps, durations, percentages, token totals, and plural counts use locale-aware formatters. This is a presentation-only boundary: sprint, task, and project names; event messages; provider or agent output; Git branches; pull request and CI details; attention descriptions; runtime diagnostics; intervention content; and API error text are always rendered verbatim. Locale changes do not affect realtime subscriptions, runtime projection, event ordering, status precedence, or action endpoints.

## Verification

Foundation coverage is in `tests/dashboard/v2/i18n-foundation.test.tsx`. Live-route regressions additionally exercise German reconnecting, recovery, stale, and error states and verify that runtime-authored payload text remains unchanged. Existing Live suites continue to cover replay, duplicate suppression, selected-sprint scoping, action failures, reduced motion, keyboard interaction, and responsive surfaces.
