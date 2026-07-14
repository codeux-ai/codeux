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

English and German must declare exactly the same top-level keys. Interpolation treats replacement values as literal text, and plural messages require an `other` form. Plural selection receives the raw count, while the reserved `{count}` token is number-formatted for the active locale. Other locale-aware formatting also delegates to the browser's native `Intl` implementation.

Keep each catalog with its owning feature and import it only where the feature is loaded. Translate dashboard-authored interface copy only. Never translate provider output, API responses, stored instructions, project data, runtime diagnostics, or user-authored content.

Browser Preview is the first route-wide catalog. Its components use the active locale for copy, pluralized session/environment counts, and pending port summaries, while URLs, paths, commands, environment data, logs, names, ports, container identifiers, and server diagnostics remain literal runtime values.

For onboarding specifically, provider and dependency names, detected paths, model IDs, command snippets and installation output, and API-returned readiness diagnostics stay verbatim. The locale changes only dashboard-owned framing and accessible names; submitted provider IDs, enums, credentials, and settings drafts are unchanged.
