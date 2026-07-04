# Code UX Projects Design System

This document defines the Projects route as an operational inventory for connected repositories and local workspaces.

## Goals

* **Inventory First:** Project identity, filesystem path, branch, host, and setup state must scan before decorative effects.
* **Clear Hierarchy:** Selection, setup, health, and destructive actions have distinct visual weights and accessible labels.
* **Restrained Atmosphere:** Signal and Ember remain the only decorative accent families. Motion and gradients support state, not card novelty.

## Project Cards

### Layout & Density

* Cards use a stable inventory stack: status/source row, identity block, setup feedback, metadata manifest, stats, completion, and action toolbar.
* Metadata rows use fixed label/value tracks so repository URLs, paths, branches, hosts, and timestamps align across cards.
* Long project names use two-line clamping. Long paths, URLs, IDs, branch names, and host labels use `min-w-0`, `truncate`, and `title` attributes so the card does not grow wider than its grid track.
* The footer action toolbar stays pinned to the bottom and wraps without hiding icon-only actions.
* Stat numerals are compact and left-aligned. Gradient numerals are reserved for a completed task set, not every metric.

### Responsive Design

* **Grid Sizing:** Use `minmax(min(100%,320px),1fr)` so cards fit narrow viewports without horizontal scrolling.
* **Page Header:** Keep header actions in the shared `PageHeader` action slot and let status pills/CTAs wrap.
* **Filter Strip:** Render filters as a glass surface with `aria-pressed`; the strip can occupy full width on mobile and shrink to fit on larger screens.
* **Action Wrapping:** Card actions, filter tabs, page actions, and setup dialog buttons must use wrapping or stacked mobile layouts.
* **Dialogs:** Setup dialogs use `max-h-[calc(100vh-2rem)]`, internal scrolling, and `flex-col-reverse sm:flex-row` actions.

### Visual Style

* **Backgrounds:** Use translucent white/dark surfaces with delicate borders and enough contrast for light and dark modes.
* **Borders:** Use `border-black/[0.06]` and `border-white/[0.06]` as the baseline; selection may add an Ember border/ring.
* **Status Spine:** The left card spine is the primary status encoding. Status dots are secondary and remain small.
* **Decorative Effects:** `WaveFluid` appears only for selected or running cards. `BorderTrace` appears only for selected cards. Running glow is subtle and status-colored.
* **Watermarks:** Monogram watermarks stay low opacity and must not compete with metadata.
* **Accents:** Do not introduce hues beyond Signal, Ember, and semantic status colors.

### State Management

* **Default:** Clean inventory surface with subdued watermark and no persistent animated border.
* **Hover:** Gentle lift and subtle tint, without changing content order or causing layout shift.
* **Selected:** Ember border, ring, and explicit selected badge; the primary select button uses `aria-pressed`.
* **Running/Active:** Status spine pulses with reduced-motion support; setup progress appears as a compact clickable row when an invocation is available.
* **Failed/Needs Review:** Use semantic status colors only in the spine, dot, and status label.

## Empty And Loading States

* Loading uses the shared skeleton loader inside the card grid region.
* Empty inventory uses a single glass surface with a concise message and an Add Project CTA.
* The add-card remains available whenever a non-empty inventory is shown and uses the accessible label `Add Project: local or Git`.

## Add Project Modal & Setup Surfaces

* **Consistency:** Forms, segmented options, directory browsers, setup option cards, and CTAs share the same rounded glass surfaces and Ember focus rings.
* **Hierarchy:** The initialize-with-setup affordance is a bordered setup panel, followed by setup scope cards only after the user continues.
* **Accessibility:** Setup option cards expose `aria-pressed`; icon-only or compact actions keep explicit accessible names.
* **Responsive Text:** Setup labels and descriptions use `min-w-0`, truncation where appropriate, and internal wrapping so long names do not overflow modal or dialog bounds.
