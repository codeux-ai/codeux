# Live Runtime Visual System

The dashboard's Live page and runtime components follow a distinct visual system optimized for an operational command surface. Under pressure, it is crucial that the interface provides high trust and fast scanability.

## Core Principles

1. **Calmer Operational Command Surface**: The live runtime avoids excessive visual noise. Surfaces and panels prioritize clear, calm presentation of status and controls without heavy decorative backgrounds.
2. **Standardized Containers**: Component wrappers (like task cards, panels, event feeds) use a unified semantic container style rather than bespoke styling.
   - Standard background: `bg-white dark:bg-void-800` (often represented by semantic `--surface-glass` in overarching design tokens).
   - Standard borders: `border border-black/[0.08] dark:border-white/[0.08]` (or `--border-hairline`).
   - Standard shadows: `shadow-sm` (or `--elevation-base`).
   - We avoid heavy glassmorphism (`backdrop-blur-2xl`), large shadows, and colored gradient backgrounds.
3. **No Heavy Effects**: Decorative animations and SVGs like `WaveFluid` or `BorderTrace` are removed from the live runtime. State changes (active, paused, idle, error) are communicated through restrained visual cues (e.g., standard status color dots, labels, or badges) rather than intense background shifts.
4. **Accessible Status Language**: Information density is balanced. Event feeds, idle states, error banners, and attention ledgers have distinct, well-spaced empty/loading/error treatments that don't compete with active controls.

## Operational State Hierarchy

- **Idle**: Clean empty states with minimal animation, inviting the start of a sprint.
- **Active**: Crisp, clear execution feed and task cards. Focus is on data and controls.
- **Paused / Intervention**: Attention items and blocked states are clearly labeled but visually separated to not overwhelm.
- **Recovering / Error**: Disconnects or errors use restrained alert styling (e.g., standard red/amber borders) rather than full-screen takeovers.
- **Stopped**: A stable final state reflecting the completed execution.

By adhering to these rules, the Live page remains a focused, professional workspace.

## Accessibility Rules

- Event feeds and timelines should use `role="log"` or `role="region"` with clear `aria-label`s.
- Transient elements must handle focus properly.
- Action buttons (claim, resolve, dismiss, cancel, etc.) must include accessible labels specifying their target item.
- Animations for spinners must be `motion-safe`.

## Responsive Layouts
- Live Runtime panels enforce strict boundaries by adding `min-w-0` to large grid columns (e.g., `xl:col-span-8 flex flex-col gap-5 min-w-0`) to prevent blowout.
- Dense runtime data (like stat grids in ExecutionRuntimePanel and AttentionQueuePanel) switch from 2 columns to 3 or 4 columns at the `sm` or `md` breakpoints to avoid squeezing content.
- Header actions and connections labels natively `flex-wrap` to handle touch-friendly interactions on phones and constrained layouts without losing controls.
