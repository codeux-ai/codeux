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

Global navigation, title-bar controls, search, notifications, documentation-viewer chrome, status presentations, and reusable control defaults use the `messages/shell.ts` catalog. Navigation labels are resolved from stable navigation item IDs for each surface, so the sidebar, dock, top navigation, search, tooltips, and experience-mode filters share translated labels without changing routes, feature flags, or persisted IDs.

Reusable controls use the provider locale when mounted in the dashboard and retain an English compatibility fallback when rendered independently. Explicit caller-provided labels, placeholders, and helper text always take precedence over translated defaults. Locale changes update the mounted controls in place and do not reset their local interaction state.

Localization applies only to dashboard-authored interface copy. API responses, provider output, stored instructions, project and sprint data, runtime diagnostics, and all other user-authored content must remain unchanged.

Notification panels translate their chrome, severity labels, relative times, and dashboard-generated recovery labels. Server-authored notification titles, summaries, reasons, instructions, context values, recommended actions, and error text are rendered verbatim. The documentation viewer similarly translates route headings, search, navigation, pagination, landmarks, and counts while keeping fetched document titles, descriptions, section names, source paths, and Markdown bodies in English.

## Verification

Foundation coverage is in `tests/dashboard/v2/i18n-foundation.test.tsx`. It exercises startup defaults, stored German restoration, live switching without control remounts, invalid and unavailable storage, cross-tab events, interpolation, plural rules, all formatter families, and HTML `lang` synchronization. Focused navigation, notification, title-bar, documentation-viewer, and shared-control tests cover the shell boundaries and English-content exceptions.
