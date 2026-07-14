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

## Translation scope

The root catalog owns shell copy, while `messages/sprint-authoring.ts` owns Sprint Composer, task and sprint modals, Quicksprint browsing/editing/execution, planning progress, Markdown transfer, and sprint settings-override chrome. Presentation helpers accept an explicit locale where they are also used outside components, keeping their output deterministic in tests and non-component consumers.

Localization applies only to dashboard-authored interface copy. API responses, provider output, stored instructions, project and sprint data, runtime diagnostics, and all other user-authored content must remain unchanged.

Sprint authoring treats this as a strict data boundary: sprint goals, task prompts, template Markdown, combined planning prompts, provider/model identifiers, agent names, schedule targets, and settings keys and values are never passed through the translator. Only the labels, descriptions, validation, progress text, and accessible announcements surrounding those values are localized.

## Verification

Foundation coverage is in `tests/dashboard/v2/i18n-foundation.test.tsx`. Feature coverage additionally exercises German sprint validation and planning modes, Quicksprint execution and cancellation, provider failures, Markdown round-trips, settings override save/reset, and keyboard/focus behavior. These tests assert both localized chrome and verbatim authoring payloads.
