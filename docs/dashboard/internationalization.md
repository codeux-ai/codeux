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

The application shell and File Browser are localized. The File Browser owns `messages/file-browser.ts` and translates page, session, file tree, changes, viewer, diff, loading, recovery, Monaco loading, and accessibility chrome. Counts and the displayed snapshot timestamp use the active locale's `Intl` formatters.

Localization applies only to dashboard-authored interface copy. API responses, provider output, stored instructions, project and sprint data, runtime diagnostics, and all other user-authored content must remain unchanged.

For File Browser specifically, paths, filenames, file contents, diff text, syntax language IDs, Git refs, project and sprint names, binary metadata, and backend error details pass through unchanged. Localized recovery sentences may surround an error detail, but the detail itself is interpolated verbatim. Git change ordering and diff calculations are not locale-dependent.

## Verification

Foundation coverage is in `tests/dashboard/v2/i18n-foundation.test.tsx`. File Browser coverage lives in `tests/dashboard/v2/file-browser-page.test.tsx`, `tests/dashboard/v2/components/file-browser.test.tsx`, the colocated File Browser regression suite, and `tests/e2e/projects/file-browser.spec.ts`. Together they cover German sessions and controls, locale-aware summaries, repository-data preservation, keyboard/accessibility behavior, stale data, failures, binary files, diffs, long paths, and responsive containment.
