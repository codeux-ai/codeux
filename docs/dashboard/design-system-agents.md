# Code UX Dashboard: Agents Design System

## Core Aesthetic
The Agents management surface leans into a premium "Workshop" feel. We use a lot of glassmorphism (`backdrop-blur-md` to `backdrop-blur-2xl`), very soft explicit gradients based on the agent's accent colors, and precise, delicate borders. Empty states should feel intentional, not like missing content.

## Color & Transparency Rules
- **Base Cards (Unselected):** `bg-white/55 border-black/[0.06] backdrop-blur-xl`.
- **Selected Cards:** `bg-white/85 border-signal-500/40 shadow-[0_8px_32px_rgba(0,224,160,0.12)]`.
- **Dark Mode Cards:** Ensure proper translation, typically using `bg-void-800/40` to `bg-void-800/75`.
- **Dashed Borders (Empty/New files):** Use `border-dashed border-black/[0.1]` in light mode.

## Interaction & State (Hover & Focus)
- **Hover on Interactive Cards:** Shift cards up (`hover:-translate-y-0.5`), intensify shadows (`hover:shadow-[0_8px_24px_...]`), and tint background (`hover:bg-white/80`).
- **Focus Rings:** Ensure all buttons have explicit `focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30`.

## Badges and Sync States
Use explicit badging inside `.code-ux/agents` lists:
- **Active / Primary Label:** `border-signal-500/30 bg-signal-500/10 text-signal-600 shadow-sm`.
- **Synced:** `border-black/[0.08] bg-white/80 text-slate-500 shadow-sm`.
- **Out of Sync:** `border-amber-400/30 bg-amber-400/15 text-amber-600`.
- **Missing Source:** `border-status-red/20 bg-status-red/8 text-status-red`.

## Empty States
For empty states on the Agents page, avoid generic `<EmptyState />` implementations. Instead, use tailored rounded containers (`rounded-[1.9rem]`), dashed borders (`border-dashed border-black/[0.08]`), and a highly blured backdrop (`backdrop-blur-2xl`) that houses an oversized icon container (`h-16 w-16 bg-signal-500/10 text-signal-600 shadow-sm ring-1 ring-slate-900/5`).
