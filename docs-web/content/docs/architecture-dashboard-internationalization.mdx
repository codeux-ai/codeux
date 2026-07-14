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

English and German must declare exactly the same top-level keys. Interpolation treats replacement values as literal text, plural messages require an `other` form, and locale-aware formatting delegates to the browser's native `Intl` implementation.

Keep each catalog with its owning feature and import it only where the feature is loaded. Translate dashboard-authored interface copy only. Never translate provider output, API responses, stored instructions, project data, runtime diagnostics, or user-authored content.

The Knowledge route is a concrete feature catalog: its headers, document controls and states, ingestion dialogs, search feedback, confirmations, and accessible announcements support English and German. Counts, sizes, dates, and similarity percentages follow the active locale, while document data, paths, names, identifiers, search excerpts, partial-failure diagnostics, and API errors remain verbatim.

## Settings localization boundaries

The Agents, Techstacks, and Guidance settings surfaces use `messages/settings-agents-guidance.ts`. Component copy follows the provider's active locale, while locale-explicit presentation helpers accept `en` or `de` for tests and non-component consumers.

Localization stops at the persistence boundary: agent and stack ids, preset and storage names, package labels, application-kind values, reflection criteria, memory/instruction markdown, and custom guidance remain byte-for-byte as authored. Persistent-skill storage creation, editing, deletion, and agent attachments still mutate immediately; changing locale does not move those operations into the Settings draft or bypass pending, confirmation, recovery, and focus-restoration behavior.

For onboarding specifically, provider and dependency names, detected paths, model IDs, command snippets and installation output, and API-returned readiness diagnostics stay verbatim. The locale changes only dashboard-owned framing and accessible names; submitted provider IDs, enums, credentials, and settings drafts are unchanged.
