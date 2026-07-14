# Dashboard Internationalization

The v2 dashboard supports English (`en`) and German (`de`) interface copy. English is the default when no valid saved preference exists. Code UX does not automatically select a language from browser preferences, synchronize the choice to the backend, or expose additional dashboard locales.

## User workflow

Open **Settings → Appearance → Display Settings → Language**, then choose **English** or **Deutsch**. The dashboard applies the choice immediately in both System and Project views; the Language control is independent of Settings dirty tracking, **Save Changes**, and **Reset**.

The preference is stored in the current browser profile under `codeux.dashboard.locale.v1`:

- a refresh or browser restart restores the selected language;
- another open Code UX tab in the same browser profile follows the change through the browser `storage` event;
- clearing the preference resets open tabs to English; and
- a missing, invalid, unavailable, or throwing storage implementation safely falls back to English. If storage is unavailable, an in-session change still applies but cannot persist across a restart.

Each locale change also updates the root HTML `lang` attribute to `en` or `de`. This keeps browser and assistive-technology language metadata aligned with the visible dashboard chrome.

## Localization boundary

Internationalization is a presentation boundary. It translates dashboard-owned labels, controls, validation, status framing, accessibility text, and other interface chrome. Locale-aware number, date, time, relative-time, list, percentage, size, and plural presentation uses the active locale without changing the underlying values.

The subsystem does not change backend, API, or MCP contracts. Locale is not sent as a runtime setting, persisted in the Code UX database, or applied to provider requests. Contract identifiers and serialized values remain locale-neutral.

Provider output, runtime and API messages, diagnostics, project and sprint records, task prompts, chat messages, stored instructions, names, identifiers, paths, source code, and all other user-authored or externally supplied content are rendered verbatim. Localized labels may frame those values, but must not rewrite them or pass them through a message catalog.

The internal Docs viewer follows the same rule. Its dashboard-owned chrome—navigation, search, pagination, counts, landmarks, and empty or error states—is localized. English documentation bodies, document titles, descriptions, section names, source paths, and source content remain English.

## Runtime architecture

The dependency-free runtime lives in `dashboard/src/v2/i18n/`:

| Module | Responsibility |
| --- | --- |
| `locales.ts` | Closed locale contract, typed message bundles, English fallback, interpolation, and plural selection |
| `storage.ts` | Safe browser-local persistence under the versioned locale key |
| `formatters.ts` | Locale-bound native `Intl` formatters |
| `context.tsx` | Root provider, hooks, immediate switching, HTML `lang`, and cross-tab updates |
| `messages/` | Feature-owned English and German catalogs |

`initializeDashboardLocale` restores the preference and synchronizes the document language before the application root renders. `DashboardI18nProvider` then owns the active locale. Its `setLocale` method updates context, the document language, browser storage, and the dashboard locale-change event in one operation.

The root application catalog contains only shell copy, and route or feature catalogs stay with their owners. Dedicated route components declared with Preact `lazy(() => import(...))` load their feature catalogs on demand with the same route chunk instead of contributing those catalogs to the eager application graph.

This does not apply to every routed or conditional surface. `main.tsx` eagerly imports the Overview route component (`DashboardV2`), the Live route component (`LiveSessionPage`), and the onboarding surface (`OnboardingExperience`). Their `overview`, `live`, and `onboarding` catalogs are therefore eagerly imported too, although those surfaces can still lazy-load heavier child components such as Overview telemetry, the Live DAG and boat-race views, or onboarding backgrounds. Treat feature ownership and loading strategy as separate concerns, and verify the entrypoint import before describing a catalog as on-demand.

Pure presentation helpers accept an explicit locale and normally default to English for compatibility. Mounted components read the active provider locale. Optional hooks may supply the English compatibility context only when no root provider exists; they never override an active locale.

## Typed messages, interpolation, and plurals

`defineDashboardMessages` preserves message keys and requires the English and German catalogs in a bundle to have matching keys at compile time.

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

Interpolation performs literal replacement of named `{variable}` tokens. Values are never evaluated or inserted as HTML, and a missing variable remains visible for diagnosis. Keep provider, runtime, and user-authored values outside translation templates unless a localized dashboard-owned sentence must frame one of those values.

Plural selection uses the raw numeric count with `Intl.PluralRules` for the active locale. Every plural message requires an `other` form. The reserved `{count}` value is formatted with the locale's `Intl.NumberFormat`; a caller-supplied formatted `count` value is preserved.

`useDashboardI18n` also exposes `formatNumber`, `formatDate`, `formatTime`, `formatRelativeTime`, and `formatList`. New localized UI should use these functions or an explicit locale-aware presentation helper instead of a fixed English formatter.

## Adding a feature catalog

1. Create a focused module under `dashboard/src/v2/i18n/messages/` and define matching English and German keys with `defineDashboardMessages`.
2. Import the catalog only from its owning shell, route, or feature. Do not add route copy to the eager root catalog.
3. Translate dashboard-authored presentation only, and use the shared formatters for locale-sensitive values.
4. Add the catalog to both the required manifest and imported bundle map in `tests/dashboard/v2/i18n-catalog-parity.test.ts`.
5. Add focused English/German behavior tests, including accessible names and the verbatim-data boundary where the feature renders external content.

## Adding a locale

Adding a locale is an explicit product and code change; it is not automatic browser-language detection. A complete locale addition must:

1. extend the closed locale contract and default-resolution logic in `locales.ts` and `storage.ts`;
2. add a complete catalog with matching keys, placeholders, and supported plural forms to every registered feature bundle;
3. add the locale's user-facing choice and change announcement to the Appearance panel;
4. verify the shared `Intl` formatters and HTML `lang` value for the locale; and
5. extend foundation, catalog-parity, runtime-boundary, feature, and end-to-end tests.

Do not ship a partially translated locale or silently fall back route-by-route. English fallback exists as a runtime recovery path, not as a substitute for catalog completeness.

## Test and static-copy expectations

The main guardrails are:

- `tests/dashboard/v2/i18n-foundation.test.tsx` for defaults, persistence, live switching, storage recovery, cross-tab behavior, interpolation, plurals, formatters, and HTML `lang`;
- `tests/dashboard/v2/i18n-catalog-parity.test.ts` for the required feature manifest, imported bundle parity, keys, shapes, placeholders, plural categories, non-empty copy, and accidental HTML;
- `tests/dashboard/v2/i18n-runtime-boundary.test.tsx` for localized framing around unchanged provider, documentation, and user-authored content;
- focused feature and accessibility suites for rendered English and German behavior; and
- `tests/e2e/navigation/dashboard-i18n.spec.ts` for the Language selector, persistence, production-route fan-in, responsive and keyboard behavior, and verbatim fixture content.

`pnpm run check:dashboard-i18n` is the static-copy guardrail. It scans production dashboard TypeScript and TSX for user-facing literals outside feature catalogs. `scripts/dashboard-i18n-allowlist.json` allows only reviewed exact-path, exact-line, exact-copy exceptions with a rationale, such as protocol values, code examples, license text, or content intentionally rendered verbatim. New dashboard-authored copy belongs in a typed catalog rather than in the allowlist.
