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

Sprint authoring uses `messages/sprint-authoring.ts` for Sprint Composer, sprint/task modals, Quicksprint, planning progress, Markdown transfer, and sprint settings-override chrome. Its boundary is intentionally presentation-only: sprint goals, task prompts, template Markdown, combined prompts, provider/model IDs, agent names, schedule targets, and settings keys and values pass through unchanged.

## Nodes route

The feature-gated Nodes route imports its own `messages/nodes.ts` catalog. English and German cover its library, palettes, canvas and minimap controls, inspectors, governance review, validation summaries, run debugger, scheduling entry point, empty/error states, and accessible names. Locale-explicit helpers serve the pure node view models and dashboard-generated canvas and agent-command validation explanations.

This boundary is presentation-only: graph serialization, ids and types, schema keys, command names, configuration values, migration markers, skill names, API errors, policy/provider diagnostics, run logs, and execution payloads remain unchanged. Known status values are mapped to localized display text without changing the underlying contract value.

## Memory route boundary

The Memory route has a feature-owned English and German catalog covering map controls, tier and scope filters, search, cards, the inspector, add/delete and batch actions, accessible announcements, and the embedding-model catalog and custom-model form. Locale-aware `Intl` formatting handles counts, plurals, percentages, dates, strengths, and file sizes without changing numeric values or filter/sort behavior. Localized category labels can be searched while the persisted category keys remain stable.

The localization boundary deliberately excludes memory titles and content, claims, evidence, tags, agent names, model IDs, catalog descriptions, languages, licenses, URLs, filenames, and server/API diagnostics. Those values are rendered exactly as supplied.

## Agents route boundary

The lazy `/agents` route imports its own `messages/agents.ts` catalog. English and German cover the roster, preset detail/editor, validation, avatar customization, instruction files, memory and MCP configuration, repository push feedback, compatibility updates, loading and empty states, and accessibility labels. Dates, counts, token estimates, byte sizes, and plural messages use the active locale.

Agent-authored and runtime data stays byte-for-byte outside translation: preset names and labels, system instructions, memory templates, Markdown files, MCP server/tool names, storage names, provider/model names, repository and invocation output, and API errors. Persisted identifiers and configuration values are likewise unchanged; the route translates only their presentation.

## Settings localization boundaries

The Agents, Techstacks, and Guidance settings surfaces use `messages/settings-agents-guidance.ts`. Component copy follows the provider's active locale, while locale-explicit presentation helpers accept `en` or `de` for tests and non-component consumers.

Localization stops at the persistence boundary: agent and stack ids, preset and storage names, package labels, application-kind values, reflection criteria, memory/instruction markdown, and custom guidance remain byte-for-byte as authored. Persistent-skill storage creation, editing, deletion, and agent attachments still mutate immediately; changing locale does not move those operations into the Settings draft or bypass pending, confirmation, recovery, and focus-restoration behavior.

## Overview route

The Overview route owns `messages/overview.ts`. Its headers, landmarks, metric and telemetry labels, source and task states, controls, plural counts, live-region announcements, and loading/empty/error fallbacks support English and German. Locale-bound formatters present counts, percentages, dates, costs, durations, and runtime times without changing timestamp interpretation, data ordering, polling, or realtime behavior.

Live project, sprint, task, branch, repository, provider, and model values remain verbatim. Server errors, attention descriptions, and runtime-authored execution text are also outside the translation boundary.

Active-stream task rows localize their status labels and announcements, but the duration field always renders the runtime-provided task duration unchanged for pending, active, review, and completed tasks.

Browser Preview is the first route-wide catalog. Its components use the active locale for copy, pluralized session/environment counts, and pending port summaries, while URLs, paths, commands, environment data, logs, names, ports, container identifiers, and server diagnostics remain literal runtime values.

For onboarding specifically, provider and dependency names, detected paths, model IDs, command snippets and installation output, and API-returned readiness diagnostics stay verbatim. The locale changes only dashboard-owned framing and accessible names; submitted provider IDs, enums, credentials, and settings drafts are unchanged.
