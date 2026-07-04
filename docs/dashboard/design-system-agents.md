# Code UX Dashboard: Agents Design System

## Core Aesthetic
The Agents management surface is a cohesive studio for preset authoring, avatar identity, repository sync, memory controls, and instruction-file management. Use one family of glass surfaces (`backdrop-blur-xl` to `backdrop-blur-2xl`), soft top highlight lines, delicate borders, and restrained shadows so the route reads as a single product area rather than separate widgets. Agent accent colors should identify the avatar and selected item; they should not compete with status colors or primary actions.

## Color & Transparency Rules
- **Base Cards (Unselected):** `bg-white/55 border-black/[0.06] backdrop-blur-xl`.
- **Selected Cards:** `bg-white/85 border-signal-500/40 shadow-[0_8px_32px_rgba(0,224,160,0.12)]`.
- **Dark Mode Cards:** Ensure proper translation, typically using `bg-void-800/40` to `bg-void-800/75`.
- **Dashed Borders (Empty/New files):** Use `border-dashed border-black/[0.1]` in light mode.
- **Studio Shells:** Hero, detail, preset editor, instruction editor, and memory popovers use `rounded-[1.9rem]`, `border-black/[0.06]`, `bg-white/68`, `shadow-[0_2px_20px_rgba(0,0,0,0.04)]`, and `backdrop-blur-2xl` with the equivalent dark-mode void surface.
- **Nested Studio Sections:** Editor sections use `rounded-[1.6rem]`, `bg-white/42`, a subtle top highlight, and restrained shadows. Avoid introducing new panel treatments inside the same editor.

## Interaction & State (Hover & Focus)
- **Hover on Interactive Cards:** Shift cards up (`hover:-translate-y-0.5`), intensify shadows (`hover:shadow-[0_8px_24px_...]`), and tint background (`hover:bg-white/80`).
- **Focus Rings:** Ensure all buttons have explicit `focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30`.

## Badges and Sync States
Use explicit badging inside `.code-ux/agents` lists:
- **Active / Primary Label:** `border-signal-500/30 bg-signal-500/10 text-signal-600 shadow-sm`.
- **Synced:** `border-black/[0.08] bg-white/80 text-slate-500 shadow-sm`.
- **Out of Sync:** `border-amber-400/30 bg-amber-400/15 text-amber-600`.
- **Missing Source:** `border-status-red/20 bg-status-red/8 text-status-red`.

Repository sync failures and missing markdown sources are semantic states, not decoration. Use amber only for drift/unsaved work and status red only for missing source or failed sync/error messages. Global route errors should use an alert container with a short status label and the raw error message below it.

## Hierarchy Rules
- Hero actions live together in the header action cluster: secondary repository sync first, primary new-agent action second.
- Roster stat cards use metric typography and icon tone, but avoid heavy animation so they do not compete with avatar identity.
- Rail cards show avatar or instruction-file identity first, then name, route or path metadata, and a compact status badge aligned to the trailing edge.
- Detail panels prioritize the avatar stage and agent name before provider, model, MCP, system prompt, memory, and source-path metadata.
- Editor panels use a sticky header with dirty/saved/saving state, then profile/appearance, behavior/memory, knowledge, routing, tools, and metadata in that order.
- Memory configuration is visually part of the Agents studio. Use signal/slate treatment and the shared glass cards rather than a separate violet subsystem.

## Empty States
For empty states on the Agents page, avoid generic `<EmptyState />` implementations. Instead, use tailored rounded containers (`rounded-[1.9rem]`), dashed borders (`border-dashed border-black/[0.08]`), and a highly blurred backdrop (`backdrop-blur-2xl`) that houses an oversized icon container (`h-16 w-16 bg-signal-500/10 text-signal-600 shadow-sm ring-1 ring-slate-900/5`). Empty states should include a small uppercase eyebrow, a display-weight title, and one concise body sentence.

Loading states should be explicit route-local studio surfaces with `role="status"` where content loads asynchronously, including instruction-file editor loading. Avoid blank panels or generic spinners when the user has already selected a project, preset, or file.

## Responsive Layouts
- Use `flex-col-reverse` for primary-secondary layouts so side panels (like roster) stack below editors on small viewports.
- Apply `min-w-0` aggressively in `flex` containers and flex children where text truncation is required.
- Ensure action button clusters wrap natively using `flex-wrap` and preserve alignment.
