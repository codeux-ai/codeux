# Jules Agent OS — Design System & Styleguide

> Version 1.0 — Dashboard V2
> Stack: Preact · Tailwind CSS v4 · GSAP · Lucide Icons · TanStack Router

---

## Design Philosophy

### "Warm Void"

The Jules Agent OS aesthetic is built on a single tension: **warmth vs. precision**. The darkness is never cold. The light is never sterile. Every surface, animation, and interaction should feel like it exists in a physical space — weighty, responsive, alive.

**Core principles:**

1. **Warmth over cold.** Backgrounds use warm charcoal (`#0E0C0A`), not pure black. Light backgrounds use cream (`#F9F8F4`), not pure white. Every neutral has a warm undertone.

2. **One signal, not noise.** A single luminous accent color — Signal Jade (`#00E0A0`) — carries all primary interactive meaning. Never introduce a new hue for decoration.

3. **Motion serves meaning.** Every animation exists because it communicates state, response, or data. Gratuitous animation is removed. Purposeful animation is crafted.

4. **Space is content.** Generous whitespace is non-negotiable. Padding and gap values should feel almost excessive. The eye needs room to land.

5. **Precision typography.** Numbers use monospace. Labels use tight uppercase tracking. Headlines use display weight. Never mix these roles.

---

## Color System

### Palette Reference

All colors are defined in `tailwind.config.ts`.

#### Void (Backgrounds)

The warm dark scale. Used for surfaces, backgrounds, and depth layering.

| Token | Hex | Usage |
|---|---|---|
| `void-950` | `#080605` | Deepest possible surface, rarely needed |
| `void-900` | `#0E0C0A` | Main app background (dark mode) |
| `void-800` | `#181411` | Card surfaces, elevated panels (dark mode) |
| `void-700` | `#231F1B` | Hover states, tooltips, dropdowns |
| `void-600` | `#2D2822` | Subtle dividers, borders |
| `void-500` | `#3D3730` | Visible borders at high contrast |

**Rule:** Never use pure `#000000` or `#030303`. The dark mode should feel like a warm studio, not a void.

#### Signal (Primary Accent)

One accent. Always. The entire interactive language speaks in jade.

| Token | Hex | Usage |
|---|---|---|
| `signal-300` | `#80FFD6` | Very subtle tints, glass highlights |
| `signal-400` | `#33FFB8` | Hover state of signal, glows |
| `signal-500` | `#00E0A0` | Primary accent — active states, indicators, focus rings |
| `signal-600` | `#00B882` | Pressed state, text on light backgrounds |
| `signal-700` | `#008F65` | High-contrast signal for accessibility |

**Rule:** Signal is never used for decoration. It appears when something is active, selected, running, or requires the user's attention in a positive way.

#### Ember (Secondary Accent)

Warm amber used sparingly as a secondary data accent — for weekly/volume metrics and secondary navigation states.

| Token | Hex | Usage |
|---|---|---|
| `ember-400` | `#FFD080` | Glow tints |
| `ember-500` | `#FFB800` | Secondary metric accent, Sprint page accent |
| `ember-600` | `#E0A000` | Pressed/text variant |

**Rule:** Ember appears on alternating metric cards and sprint cycles to prevent visual monotony. Never use ember for interactive affordances — that role belongs to signal exclusively.

#### Status (Semantic)

Semantic colors are reserved for machine/operational state only. They are never used for decoration.

| Token | Hex | State | Usage |
|---|---|---|---|
| `status-green` | `#00AB84` | Running / Success | Live agents, succeeded jobs, running sources |
| `status-red` | `#E3000F` | Failed / Error | Failed jobs, socket offline, error states |
| `status-amber` | `#F59E0B` | Intervention / Warning | Sources needing review, degraded states |
| `status-violet` | `#A300D6` | Legacy — do not use in new components | — |

**Rule:** If you're tempted to use `status-green` as a decorative green, use `signal-500` instead. Status colors communicate machine state — they carry cognitive weight and must not be diluted.

#### Light Mode Surfaces

| Value | Usage |
|---|---|
| `#F9F8F4` | Page background — warm cream |
| `#F5F3EF` | Sidebar background |
| `white/70` | Card surfaces with backdrop-blur |
| `black/[0.04]` | Very subtle hover fills |
| `black/[0.06]` | Input backgrounds, chip backgrounds |
| `black/[0.06]` | Border color |

---

## Typography

### Font Stack

```typescript
sans:    ['"Plus Jakarta Sans"', 'Inter', 'sans-serif']  // Body, UI labels
mono:    ['"JetBrains Mono"', 'monospace']               // Numbers, IDs, code, data
display: ['Outfit', '"Plus Jakarta Sans"', 'sans-serif'] // Headlines, section titles
```

Loaded via Google Fonts in `dashboard/index.html`.

### Scale & Usage Rules

| Role | Class | Notes |
|---|---|---|
| Hero headline | `text-5xl` / `text-6xl` / `text-7xl` `font-black tracking-tighter font-display` | Page-level titles only. Leading: `leading-[0.92]` |
| Section title | `text-2xl` / `text-3xl` `font-black tracking-tighter font-display` | Component section headers |
| Card label | `text-xl` `font-bold tracking-tight` | Card/item names |
| UI label | `text-xs` / `text-sm` `font-medium` | Form labels, metadata |
| Status tag | `text-[10px] font-bold uppercase tracking-widest` | Status badges, category chips |
| Metric number | `text-[2.25rem] font-semibold font-mono tracking-tighter` | Stat card values |
| Small data | `text-xs font-mono font-medium` | IN/OUT rows, timestamps, IDs |
| Section eyebrow | `text-xs font-bold uppercase tracking-[0.15em] font-mono` | Category labels above section titles |

### Tracking Rules

- Headlines: `tracking-tighter` (−0.05em)
- Section eyebrows: `tracking-[0.15em]` to `tracking-[0.25em]`
- Status tags: `tracking-widest` (0.1em)
- Body: default tracking (0)
- Monospace data: default tracking

**Rule:** Never use `tracking-wide` on display text. Wide tracking on large type looks amateurish. Reserve expanded tracking exclusively for small uppercase labels.

### Ghost Type

Large ghost text (`text-[6rem]`) set to near-zero opacity (`text-black/[0.04]`) is used as a background watermark behind section titles. Apply `absolute`, `pointer-events-none`, `select-none`, and `overflow-hidden` to the parent. This creates editorial depth without visual noise.

```tsx
<div className="relative overflow-hidden">
    <h2 className="text-[6rem] font-black tracking-tighter text-black/[0.04] dark:text-white/[0.04]
                   absolute -top-8 -left-3 pointer-events-none select-none font-display">
        DATA
    </h2>
    <h3 className="text-xl font-bold tracking-tight relative z-10">
        Projects & Sources
    </h3>
</div>
```

---

## Spacing & Layout

### Grid System

The dashboard uses a 12-column grid at `xl` breakpoint with `gap-20`. Main content occupies `xl:col-span-8`, sidebar/telemetry takes `xl:col-span-4`.

### Page Padding

```
px-8 md:px-20 py-24
```

This creates the breathing room that defines the aesthetic. Never reduce below `px-8`.

### Gap Scale

| Context | Gap |
|---|---|
| Stat card grid | `gap-5` |
| Section-to-section | `gap-24` |
| Source cell grid | `gap-10 md:gap-14 lg:gap-20` |
| Nav items | `gap-0.5` (packed list) |
| Dock items | `gap-1.5` |
| Inline icon+label | `gap-2` to `gap-3` |

### Max Width

Content is always capped at `max-w-[2400px] mx-auto`. This prevents extreme stretching on ultra-wide displays while allowing the expansive feel.

### Section Dividers

Use the pill-label divider pattern to separate major content zones:

```tsx
<div className="w-full flex items-center justify-center py-4 relative z-10 overflow-hidden">
    <div className="absolute inset-y-1/2 inset-x-0 h-px bg-gradient-to-r
                    from-transparent via-black/[0.06] dark:via-white/[0.06] to-transparent" />
    <div className="bg-[#F9F8F4] dark:bg-void-900 px-6 py-1.5 border border-black/[0.06]
                    dark:border-white/[0.06] rounded-full shadow-sm relative z-10
                    text-[9px] font-bold uppercase tracking-[0.25em] text-slate-400 dark:text-slate-600">
        Section Label
    </div>
</div>
```

**Critical:** Always add `overflow-hidden` to the divider wrapper. Never use `w-[200vw]` for decorative lines — it causes horizontal scroll.

---

## Component Patterns

### Cards

Cards are the primary container. Every card follows this base:

```tsx
<div className="relative overflow-hidden
                bg-white/70 dark:bg-void-800/60
                backdrop-blur-2xl
                border border-black/[0.06] dark:border-white/[0.06]
                rounded-[1.75rem]
                p-7
                shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]
                group">
```

Key rules:
- Always `overflow-hidden` — required for wave effects and rounded clipping
- Always `group` — enables all child `group-hover:` states
- Border at `black/[0.06]` light / `white/[0.06]` dark — barely visible, structural not decorative
- `backdrop-blur-2xl` — gives the glass-like feel on top of any background
- `rounded-[1.75rem]` — the exact radius that feels premium without being bubbly

### Metric Cards (HeaderStats pattern)

Metric cards add three hover layers on top of the base card:

1. **Hover tint** — a very subtle color wash (`group-hover:bg-signal-500/[0.025]`)
2. **WaveFluid** — fluid wave animation at the card bottom
3. **BorderTrace** — gradient lines that trace the card edges

The Sparkline SVG sits `absolute bottom-0 left-0 w-full h-20` and uses smooth cubic bezier curves (tension 0.35). On hover, GSAP re-draws the path and applies a `drop-shadow` glow filter in the card's accent color.

### Organic Cells (SourcesGrid / SprintsPage)

The liquid blob pattern uses two elements:

```tsx
{/* 1. Shadow underlay — rendered OUTSIDE the mask, unclipped */}
<div className="absolute inset-0 shadow-[...] animate-organic pointer-events-none" />

{/* 2. Clipped liquid body — WebkitMask clips content to the organic shape */}
<div
    className="absolute inset-0 bg-white/55 dark:bg-void-800/65 backdrop-blur-3xl
               border border-white/70 dark:border-white/[0.06]
               overflow-hidden animate-organic transform-gpu"
    style={{ WebkitMaskImage: '-webkit-radial-gradient(white, black)', backfaceVisibility: 'hidden' }}
>
    {/* Inner inset highlight */}
    <div className="absolute inset-0 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.5)]
                    dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] animate-organic" />
    {/* Status ring — only for non-idle states */}
    {state.ring && (
        <div className={`absolute inset-0 border-2 animate-[spin_5s_linear_infinite]
                         scale-105 mix-blend-screen ${state.ring}`}
             style={{ borderRadius: '40% 60% 70% 30% / 40% 50% 60% 50%', clipPath: 'inset(-10px)' }} />
    )}
</div>
```

The `WebkitMaskImage: '-webkit-radial-gradient(white, black)'` is what makes `overflow-hidden` respect the organic `border-radius` shape. Without it, the content clips to a rectangle.

### Pill / Chip

```tsx
<div className="px-5 py-2.5 text-xs font-bold uppercase tracking-widest rounded-full
                bg-signal-500/8 dark:bg-signal-500/10
                text-signal-600 dark:text-signal-400
                border border-signal-500/15 dark:border-signal-500/20
                flex items-center gap-2.5
                shadow-[0_0_20px_rgba(0,224,160,0.08)]
                backdrop-blur-md">
    <span className="w-2 h-2 rounded-full bg-signal-500 relative">
        <span className="absolute inset-0 rounded-full animate-ping bg-signal-400 opacity-60" />
    </span>
    Cluster Optimal
</div>
```

### Tab Strip (Filter Pill)

A contained tab strip — not individual tab buttons:

```tsx
<div className="flex gap-1 p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-xl">
    {filters.map(filter => (
        <button className={`text-xs font-semibold tracking-wide px-3 py-1.5 rounded-lg transition-all duration-200
            ${isActive
                ? 'bg-white dark:bg-void-700 text-slate-900 dark:text-white shadow-[0_1px_4px_rgba(0,0,0,0.08)]'
                : 'text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}>
            {filter}
        </button>
    ))}
</div>
```

### Dropdown

```tsx
<div className="absolute right-0 top-full mt-2 w-56
                bg-white/95 dark:bg-void-800/95 backdrop-blur-2xl
                border border-black/[0.06] dark:border-white/[0.08]
                rounded-2xl
                shadow-[0_20px_40px_rgba(0,0,0,0.12)] dark:shadow-[0_20px_40px_rgba(0,0,0,0.4)]
                overflow-hidden z-50">
```

---

## Animation System

### Principles

1. **Entrance animations use GSAP.** Page-level and component-level entrance animations are handled with `gsap.fromTo()`. Standard entrance: `{ opacity: 0, y: 40 }` → `{ opacity: 1, y: 0 }`, `duration: 1`, `ease: "power4.out"`.

2. **Hover micro-interactions use GSAP or CSS transitions.** GSAP for anything involving physics feel (scale, rotation, filter). CSS transitions for opacity, color, and simple transforms.

3. **Continuous ambient animations use CSS keyframes.** Organic morphing, wave drift, radar pings — these run perpetually and must be CSS-only for performance.

4. **Never animate layout properties.** Do not animate `width`, `height`, `padding`, `margin`. Use `transform: scale()` instead of `width`. Use `transform: translateY()` instead of `margin-top`.

### GSAP Standard Easings

| Use case | Easing |
|---|---|
| Page entrance stagger | `power4.out` |
| Card entrance | `power3.out` |
| Elastic hover (scale) | `elastic.out(1, 0.7)` |
| Elastic release | `elastic.out(1, 0.5)` |
| Smooth SVG path | `power2.out` |
| Sparkline draw | `power3.inOut` |
| Dock entrance | `elastic.out(1, 0.7)` |

### CSS Transition Durations

| Use case | Duration |
|---|---|
| Color / opacity (instant feedback) | `duration-200` |
| Border / background (card hover) | `duration-300` |
| Filter / glow | `duration-400` |
| Border trace expansion | `duration-500` to `duration-700` |
| Wave fade-in | `duration-700` |
| Theme transition | `duration-700` |

### Organic Morph Animation

The signature biomorphic shape animation. Always alternate between `animate-organic` and `animate-organic-reverse` on adjacent elements:

```css
@keyframes organic-morph {
    0%   { border-radius: 40% 60% 70% 30% / 40% 50% 60% 50%; }
    34%  { border-radius: 70% 30% 50% 50% / 30% 30% 70% 70%; }
    67%  { border-radius: 30% 70% 60% 40% / 60% 50% 50% 40%; }
    100% { border-radius: 40% 60% 70% 30% / 40% 50% 60% 50%; }
}
```

Duration: 12s forward, 15s reverse (different speeds prevent synchronization).

### Wave Fluid Animation (Metric Cards)

The wave uses two SVG layers. **Critical implementation rules:**

- Each SVG must be `width: 200%` of its container
- Each SVG's viewBox must contain **exactly 2 complete wave cycles**
- The keyframe must be `translateX(0) → translateX(-50%)` — this is mathematically exact (50% of 200% = 100% = one cycle)
- Never use `translateX(-33.333%)` or other non-halving percentages — floating-point imprecision causes a visual jump at the loop boundary
- Layer 2 uses `animation-direction: reverse` with a negative `animationDelay` (e.g. `-3.5s`) for phase offset. No second keyframe needed.

```tsx
// Layer 1
style={{ width: '200%', left: 0, animation: 'wave-drift 6s linear infinite' }}

// Layer 2 — reverse direction, phase-offset
style={{ width: '200%', left: 0, animation: 'wave-drift 9s linear infinite reverse', animationDelay: '-3.5s' }}
```

### Border Trace Pattern

The 3-edge border trace that appears on metric card hover:

```
Bottom:  scale-x-0 → scale-x-100, origin-center, duration-700, ease cubic-bezier(0.4,0,0.2,1)
Sides:   scale-y-0 → scale-y-[0.7], origin-bottom, duration-500, delay-200
```

The delay means bottom fires first, then sides rise — creating a sequential "framing" motion. The gradient on each line fades to transparent at its ends so it blends naturally with the card corner.

### Dock Hover (Magnetic Fisheye)

The dock items use GSAP to compute proximity-based scale and lift. The magnetic radius is 110px. Scale formula:

```javascript
const ratio = 1 - Math.pow(dist / maxDist, 1.5);  // Smooth falloff
const scale = 1 + (0.45 * ratio);                   // Max 1.45x
const y     = -18 * ratio;                           // Max -18px lift
```

`Math.pow(dist/maxDist, 1.5)` creates a steeper falloff than linear, giving a tighter magnetic feel.

### Sparkline Hover Sequence

1. On mount: full draw animation via `strokeDashoffset` (length → 0), 1.4s, `power3.inOut`
2. On hover enter (via `mouseenter` on parent `.group`):
   - Re-draw from midpoint: `strokeDashoffset: len * 0.5 → 0`, 0.85s, `power2.out`
   - Glow: GSAP sets `filter: drop-shadow(0 0 5px [accentColor])` + opacity 0.55, 0.4s
3. On hover leave:
   - Remove glow: GSAP removes filter, opacity → 0.2, 0.5s

The hover re-draw starts from 50% progress (not 0%) so it feels like a refresh, not a restart.

---

## Interactive States

### Hover

Never change layout on hover. Use only:
- `opacity` — content reveals (actions, status labels)
- `background-color` — subtle tint fills
- `transform: translate / scale / rotate` — via GSAP or CSS
- `color` — text color shifts
- `filter` — glow effects
- `border-color` / `box-shadow` — via border trace or shadow

### Focus

Focus rings use `signal-500`:
```
focus:outline-none focus:ring-2 focus:ring-signal-500/10 focus:border-signal-500/40
```

### Active / Selected

Active navigation items:
- Background: `bg-signal-500/8 dark:bg-signal-500/10`
- Border (via box-shadow): `shadow-[inset_0_0_0_1px_rgba(0,224,160,0.12)]`
- Icon: `text-signal-600 dark:text-signal-400` with `drop-shadow-[0_0_8px_rgba(0,224,160,0.5)]`

### Disabled

Not yet implemented. When added: `opacity-40 pointer-events-none cursor-not-allowed`.

---

## Status Indicators

### Dot Indicator

The smallest status signal. Always `w-1.5 h-1.5 rounded-full` or `w-2 h-2 rounded-full`.

```tsx
// Running
<span className="w-2 h-2 rounded-full bg-status-green shadow-[0_0_10px_rgba(0,171,132,0.7)] animate-pulse" />

// Failed (with ping)
<div className="relative w-2 h-2">
    <div className="w-full h-full rounded-full bg-status-red shadow-[0_0_10px_rgba(227,0,15,0.7)]" />
    <div className="absolute inset-0 bg-status-red rounded-full animate-ping opacity-60" />
</div>

// Idle
<span className="w-2 h-2 rounded-full bg-slate-400 dark:bg-slate-600" />
```

**Rule:** `animate-pulse` for running. `animate-ping` for error/alert (more urgent). Static for idle.

### Status Glow Shadows

| State | Shadow |
|---|---|
| Running | `shadow-[0_0_10px_rgba(0,171,132,0.7)]` |
| Failed | `shadow-[0_0_10px_rgba(227,0,15,0.7)]` |
| Intervention | `shadow-[0_0_8px_rgba(245,158,11,0.5)]` |
| Signal active | `shadow-[0_0_10px_rgba(0,224,160,0.6)]` |
| Ember active | `shadow-[0_0_10px_rgba(255,184,0,0.6)]` |

---

## Surfaces & Depth

### Depth Scale (Dark Mode)

```
Page background    void-900   (#0E0C0A)   z-0
Card surface       void-800   (#181411)   z-10
Elevated panel     void-700   (#231F1B)   z-20
Tooltip/overlay    void-700   + backdrop-blur-2xl
```

### Glass Effect

The glass effect is achieved with `backdrop-blur-2xl` or `backdrop-blur-3xl` combined with a semi-transparent background:

```
Light: bg-white/70      Dark: bg-void-800/60
```

Never use more than `3xl` blur — it becomes too heavy and causes performance issues on Safari. Never use `backdrop-blur` on elements that don't need it (e.g. text-only elements).

### Ambient Background Glows

Used very sparingly to add dimensionality to page backgrounds. Maximum 2 radial gradients per page:

```tsx
{/* Top-left signal glow */}
<div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_-10%_-10%,
    rgba(0,224,160,0.04)_0%,transparent_60%)]
    dark:bg-[radial-gradient(ellipse_80%_50%_at_-10%_-10%,
    rgba(0,224,160,0.06)_0%,transparent_60%)]" />

{/* Bottom-right ember glow */}
<div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_110%_110%,
    rgba(255,184,0,0.03)_0%,transparent_60%)]" />
```

Opacity values: 3%–6% in light mode, 5%–10% in dark mode. These should be barely perceptible.

---

## Borders & Shadows

### Border System

| Context | Value |
|---|---|
| Card border | `border border-black/[0.06] dark:border-white/[0.06]` |
| Input border (idle) | `border-transparent` |
| Input border (hover) | `border-black/[0.08] dark:border-white/[0.08]` |
| Input border (focus) | `border-signal-500/40` |
| Dropdown border | `border-black/[0.06] dark:border-white/[0.08]` |
| TopNav border | `border-b border-black/[0.05] dark:border-white/[0.04]` |
| Sidebar border | `border-r border-black/[0.05] dark:border-white/[0.04]` |

**Rule:** Light mode borders are always `black/[opacity]`. Dark mode borders are `white/[opacity]`. Never use named colors (slate, gray) for structural borders.

### Shadow System

| Context | Shadow |
|---|---|
| Card (light) | `shadow-[0_2px_20px_rgba(0,0,0,0.04)]` |
| Card (dark) | `shadow-[0_4px_24px_rgba(0,0,0,0.2)]` |
| Dropdown | `shadow-[0_20px_40px_rgba(0,0,0,0.12)]` dark: `..._rgba(0,0,0,0.4)]` |
| Dock | `shadow-[0_20px_50px_rgba(0,0,0,0.08)]` dark: `..._rgba(0,0,0,0.5)]` |
| Button CTA | `shadow-[0_4px_12px_rgba(0,0,0,0.15)]` |

**Rule:** `rgba(0,0,0,x)` for all shadows — never colored shadows on structural elements. Colored glows (`shadow-[0_0_10px_rgba(0,224,160,0.6)]`) are only for status dots and active state indicators.

---

## Icons

All icons are from `lucide-preact`. Import only what is used.

### strokeWidth Convention

| State | strokeWidth |
|---|---|
| Active nav item | `2` |
| Inactive nav item | `1.5` |
| Status icons | `2` to `2.5` |
| Decorative / large | `1` |
| Action buttons | `1.5` |

**Rule:** Never mix `strokeWidth={1}` and `strokeWidth={2.5}` in the same visual context. Pick one register and stay consistent within a component.

### Sizes

| Context | Size |
|---|---|
| Dock | `w-5 h-5` |
| Nav sidebar | `w-4 h-4` |
| Card label | `w-5 h-5` |
| TopNav inline | `w-4 h-4` |
| Small action | `w-3 h-3` to `w-3.5 h-3.5` |
| Logo feature | `w-8 h-8` to `w-12 h-12` |

---

## Layout Architecture

### Route Structure

```
/ (root)          — TopNav + KineticDock layout wrapper
├── /             — DashboardV2 (Overview)
├── /sprints      — SprintsPage
└── /live         — LegacyApp (selected project live view)
```

### Navigation Layers

1. **TopNav** — sticky header, 60px height, contains logo, search, project selector, controls
2. **KineticDock** — `fixed bottom-7`, floating pill, magnetic hover, active route indicator
3. **Sidebar** — `w-[260px]`, only present in layout variants that require it (not currently in main V2)

### Overflow Rules

- The root layout scrolls vertically: `overflow-y-auto` on the page content wrapper
- Never add `overflow-x: hidden` to the root html/body to mask a bug — find the offending element
- Elements using `w-[200vw]` or negative insets (`-inset-x-N`) must have a parent with `overflow-hidden`
- Absolute elements that extend beyond their parent boundary need `overflow-hidden` on the nearest positioned ancestor

---

## Do's and Don'ts

### Do

- Use `group` / `group-hover:` for coordinated hover states
- Use GSAP's `overwrite: "auto"` when animations can be interrupted
- Use `transform-gpu` on elements that animate frequently (organic blobs)
- Use `pointer-events-none` on all purely decorative absolute elements
- Use `select-none` on ghost text and decorative typography
- Add `overflow-hidden` to the parent of any element with organic `border-radius` animation
- Use negative `animationDelay` to phase-offset repeating animations instead of creating new keyframes
- Keep `backdrop-blur` to `2xl` or `3xl` maximum

### Don't

- Don't use purple, indigo, fuchsia, or violet for any new interactive element
- Don't use `w-[200vw]` without an `overflow-hidden` parent
- Don't animate `width`, `height`, `top`, `left`, `margin`, or `padding`
- Don't use `!important` — fix the specificity issue instead
- Don't hardcode colors in component files — always use design token classes
- Don't use `bg-black` or `bg-white` as backgrounds — use void and cream tokens
- Don't use `animate-bounce` — it looks unprofessional. Use GSAP elastic easing instead
- Don't add `position: relative` to elements that don't need it — it creates unnecessary stacking contexts
- Don't use more than 2 ambient glows per page
- Don't use `transition-all` — always specify the property being transitioned

---

## File Reference

```
tailwind.config.ts                    — Design tokens (colors, fonts, animations)
dashboard/index.html                  — Font loading, base html classes
dashboard/src/styles.css              — Global CSS, keyframes, scrollbar, utility classes
dashboard/src/main.tsx                — Root layout, routing, theme state
dashboard/src/v2/
    DashboardV2.tsx                   — Overview page
    SprintsPage.tsx                   — Sprints page
    lib/mockData.ts                   — All prototype data
    components/
        TopNav.tsx                    — Sticky header + project selector
        KineticDock.tsx               — Floating magnetic navigation dock
        Sidebar.tsx                   — Side navigation (SVG spline + nav items)
        CanvasBackground.tsx          — Ambient background SVG + radial gradients
        HeaderStats.tsx               — Metric cards with sparklines + wave hover
        SourcesGrid.tsx               — Organic blob project cells
        TasksList.tsx                 — Active task rows with filter strip
```
