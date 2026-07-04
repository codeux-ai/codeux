# Dashboard Design System: Shared Primitives

## Objective

This document defines the semantic CSS variables and design rules for shared primitive components (Buttons, Cards, Inputs, Selects, Tables, EmptyStates, etc.) in the Code UX dashboard.

The goal is to ensure all primitives align with the signal-and-ember operational design language by sharing a consistent vocabulary for surfaces, borders, focus rings, metadata typography, and elevation levels.

## Semantic Tokens

### Surfaces & Fills

*   **`--surface-glass`**: The base background for structural primitives (e.g., Cards, Sections). Should support light and dark modes with subtle transparency.
*   **`--surface-glass-hover`**: The hover state for glass surfaces.
*   **`--fill-muted`**: A subtle fill for secondary elements (e.g., Table rows on hover, Input backgrounds).
*   **`--fill-muted-hover`**: The hover state for muted fills.

### Borders & Rings

*   **`--border-hairline`**: A very subtle border used for structure (Cards, Table cells, Inputs).
*   **`--accent-focus-ring`**: The primary focus ring color for interactive elements, typically tied to the brand's primary accent.

### Typography

*   **`--text-metadata`**: A compact, low-contrast text style (e.g., `text-xs font-medium text-slate-500`) used for secondary information like Table headers and EmptyState descriptions.

### Elevation

*   **`--elevation-base`**: Standard subtle shadow for flat cards or structural elements.
*   **`--elevation-raised`**: Slightly raised shadow for interactive elements like primary buttons.
*   **`--elevation-floating`**: Higher shadow for overlays, dropdowns, and dialogs.

## Component Guidelines

1.  **Buttons**: Action emphasis stays in the Signal Jade family: `primary` uses the higher-contrast `signal-600` stop in light mode and brand jade in dark mode, while `signal` uses luminous `signal-500`. Destructive/error actions are the only buttons that use status red. Secondary buttons are neutral glass controls on `--surface-glass` with `--border-hairline`, `--elevation-base`, and raised hover elevation. All variants share `--accent-focus-ring`, proportional padding, and stable icon/text layout. For responsive buttons containing dynamic text (e.g., pending states), avoid `whitespace-nowrap` as it causes horizontal overflow on mobile screens. Instead, apply `min-w-0` to the button, wrap the text in a `span` with `truncate min-w-0`, and add `shrink-0` to any adjacent icons. When implementing custom single-choice button groups, use standard ARIA radiogroup semantics by applying `role="radiogroup"` to the wrapper and `role="radio"` with `aria-checked` to the individual choice options.
2.  **Cards**: Built on `--surface-glass`, bordered by `--border-hairline`, grounded by `--elevation-base`, and blurred consistently with the Warm Void surface model. Card defaults include reduced-motion-safe transition classes and must place caller `className` last so page-specific layout and state overrides still win. Cards should not be nested unless the inner element is explicitly a card.
3.  **Inputs & Selects**: Inputs use `--fill-muted` and `--border-hairline`. Focus states should strictly use `--accent-focus-ring`. Error and valid states override the border but maintain the structural radius.
4.  **Tables**: Headers and mobile labels use the shared metadata treatment: `text-xs`, semibold, uppercase tracking, and `--text-metadata`. Card-like mobile rows use `--surface-glass`, `--border-hairline`, `--elevation-base`, raised hover elevation, and `--accent-focus-ring` for focus-within. Desktop rows flatten back into table structure while keeping muted hover fill and hairline cell borders. When using the custom `Table` primitive, provide the `mobileLabel` prop on `TableCell` elements so mobile layouts retain visible column labels. In sortable data tables, the parent `<th>` element must declare the `aria-sort` attribute ('ascending', 'descending', or 'none'). The internal sort `<button>` should include an explicit `aria-label` or visually hidden `.sr-only` text when the visible text is not sufficient.
5.  **EmptyStates & SectionHeaders**: Empty states are structural surfaces, not loose centered text: use `--surface-glass`, `--border-hairline`, `--elevation-base`, `--text-primary` for titles, and `--text-metadata` for supporting copy and icon tone. Section headers use the same hairline separation, `--text-primary` title color, and muted watermark fill. When displaying dynamic filter or table result counts (e.g., 'Showing 10 of 50'), apply `aria-live="polite"` directly to the text container so screen readers natively announce updates.

### Field Accessibility & Error Contracts

1.  **FieldWrapper**: Always associates labels with the first control. It dynamically passes down `id`, `aria-describedby`, `aria-errormessage`, `aria-invalid`, and `aria-required` to its children.
2.  **Helper Text & Errors**: Helper text uses `aria-describedby`. When an error becomes visible, the error ID is provided in both `aria-errormessage` and `aria-describedby` (replacing the helper text ID in `aria-describedby` to avoid redundant announcements).
3.  **FormError**: Visible errors render with `role="alert"` for assertive live-region announcements.
4.  **Inputs & Selects**: Component primitives like `Input`, `Select`, and `AvantgardeSelect` gracefully fall back to these external `aria-*` props from `FieldWrapper` to avoid duplicate ID generation or conflicting descriptions.
5.  **Required State**: Conveys required state both visually (with a red asterisk) and programmatically via `aria-required="true"` and an `sr-only` "(Required)" span.
