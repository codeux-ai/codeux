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

1.  **Buttons**: Should utilize `--elevation-raised` (for primary), `--accent-focus-ring`, and consistent proportional padding across all variants. For responsive buttons containing dynamic text (e.g., pending states), avoid `whitespace-nowrap` as it causes horizontal overflow on mobile screens. Instead, apply `min-w-0` to the button, wrap the text in a `span` with `truncate min-w-0`, and add `shrink-0` to any adjacent icons. When implementing custom single-choice button groups, use standard ARIA radiogroup semantics by applying `role="radiogroup"` to the wrapper and `role="radio"` with `aria-checked` to the individual choice options.
2.  **Cards**: Built on `--surface-glass`, bordered by `--border-hairline`, and grounded by `--elevation-base`. They should not be nested unless the inner element is explicitly a card.
3.  **Inputs & Selects**: Inputs use `--fill-muted` and `--border-hairline`. Focus states should strictly use `--accent-focus-ring`. Error and valid states override the border but maintain the structural radius.
4.  **Tables**: Headers should use `--text-metadata`. Hover states for rows apply `--fill-muted-hover`. Borders between cells use `--border-hairline`. When using the custom `Table` primitive, provide the `mobileLabel` prop on `TableCell` elements to ensure visible column labels are communicated to assistive technology on mobile layouts. In sortable data tables, the parent `<th>` element must declare the `aria-sort` attribute ('ascending', 'descending', or 'none'). The internal sort `<button>` should include an explicit `aria-label` or visually hidden `.sr-only` text.
5.  **EmptyStates & SectionHeaders**: Leverage `--text-metadata` to ensure textual consistency. Icons use `--surface-glass` for subtle emphasis without drawing primary attention away from calls to action. When displaying dynamic filter or table result counts (e.g., 'Showing 10 of 50'), apply `aria-live="polite"` directly to the text container so screen readers natively announce updates.

### Field Accessibility & Error Contracts

1.  **FieldWrapper**: Always associates labels with the first control. It dynamically passes down `id`, `aria-describedby`, `aria-errormessage`, `aria-invalid`, and `aria-required` to its children.
2.  **Helper Text & Errors**: Helper text uses `aria-describedby`. When an error becomes visible, the error ID is provided in both `aria-errormessage` and `aria-describedby` (replacing the helper text ID in `aria-describedby` to avoid redundant announcements).
3.  **FormError**: Visible errors render with `role="alert"` for assertive live-region announcements.
4.  **Inputs & Selects**: Component primitives like `Input`, `Select`, and `AvantgardeSelect` gracefully fall back to these external `aria-*` props from `FieldWrapper` to avoid duplicate ID generation or conflicting descriptions.
5.  **Required State**: Conveys required state both visually (with a red asterisk) and programmatically via `aria-required="true"` and an `sr-only` "(Required)" span.
