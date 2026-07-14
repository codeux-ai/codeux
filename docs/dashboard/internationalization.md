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

The root bundle owns shell copy, while route catalogs are imported with their features. Chat owns `messages/chat.ts`, which covers page and thread chrome, composers, quick actions, invocation metadata labels, rich-widget frames, cinematic activity, speech controls, empty/error/confirmation feedback, humor, and accessible announcements. Pure Chat presentation helpers accept an explicit locale so tests and non-component consumers use the same catalog as mounted components.

Localization applies only to dashboard-authored interface copy. Chat message bodies, prompts, quick-action request payloads, reasoning, tool names and arguments/output, provider transcripts and errors, runtime status values, scheduled instructions, entity names, and speech transcripts remain byte-for-byte display data. Localized labels may surround those values, but must never rewrite them.

Chat uses the locale-bound `Intl` formatters for timestamps, relative time, counts, percentages, token estimates, durations, and retry timestamps. Deterministic humor keeps the same seed, deck, and cadence across locales; locale only selects the message catalog.

## Verification

Foundation coverage is in `tests/dashboard/v2/i18n-foundation.test.tsx`. Chat boundary coverage is in `tests/dashboard/v2/chat-i18n.test.tsx` and the focused Chat, widget, cinematic, speech, thread, and accessibility suites. These tests verify German controls and announcements while asserting that provider/runtime payloads and fixed quick-action prompts are unchanged.
