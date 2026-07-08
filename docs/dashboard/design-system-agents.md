# Code UX Dashboard: Agents Design System

## Core Aesthetic
The Agents management surface leans into a premium "Workshop" feel. We use a lot of glassmorphism (`backdrop-blur-md` to `backdrop-blur-2xl`), very soft explicit gradients based on the agent's accent colors, and precise, delicate borders. Empty states should feel intentional, not like missing content.

## Content Privacy
- Never show real user/customer/live project names in screenshots, examples, test fixtures, PR notes, or design docs. Use generic labels such as `live project`, `customer project`, `non-test project`, or `approved local test project`.
- Agent preset examples should avoid names, repository paths, or goals that identify a real project. Generalize them before publishing.

## Color & Transparency Rules
- **Base Cards (Unselected):** `bg-white/55 border-black/[0.06] backdrop-blur-xl`.
- **Selected Cards:** `bg-white/85 border-signal-500/40 shadow-[0_8px_32px_rgba(0,224,160,0.12)]`.
- **Dark Mode Cards:** Ensure proper translation, typically using `bg-void-800/40` to `bg-void-800/75`.
- **Dashed Borders (Empty/New files):** Use `border-dashed border-black/[0.1]` in light mode.

## Interaction & State (Hover & Focus)
- **Hover on Interactive Cards:** Shift cards up (`hover:-translate-y-0.5`), intensify shadows (`hover:shadow-[0_8px_24px_...]`), and tint background (`hover:bg-white/80`).
- **Focus Rings:** Ensure all buttons have explicit `focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30`.
- **Header Actions:** Keep agent-management actions compact, pill-shaped, and visually consistent; secondary actions such as sync and push should share the same muted glass button treatment so the header reads as one control cluster.

## Avatar Scene Motion
- The 3D agent avatar uses standard Three.js materials, studio lights, pointer-aware head movement, and runtime tool props. Do not add flashlight beams, target glows, low-battery flicker overlays, or shell/screen emissive boosts that recolor the avatar.
- Reduced-motion and fallback SVG paths continue to render the static avatar without requiring WebGL.
- New avatar scene geometries, materials, textures, and lights must follow the existing `AgentAvatarScene` WebGL lifecycle split: renderer and persistent scene resources are created once, avatar/config resources rebuild independently, animation reads refs per frame, and all reachable Three.js resources are disposed on unmount.

## Badges and Sync States
Use explicit badging inside `.code-ux/agents` lists:
- **Active / Primary Label:** `border-signal-500/30 bg-signal-500/10 text-signal-600 shadow-sm`.
- **Synced:** `border-black/[0.08] bg-white/80 text-slate-500 shadow-sm`.
- **Out of Sync:** `border-amber-400/30 bg-amber-400/15 text-amber-600`.
- **Missing Source:** `border-status-red/20 bg-status-red/8 text-status-red`.
- **Persistent Skills:** show `Default off` until the agent has at least one attached skill storage and retrieval is explicitly enabled. Do not reuse memory colors or place this status inside memory filter controls.

## Persistent Skills
- Persistent skill storage is a separate agent capability from workspace memory and knowledge subscriptions. The editor/detail panels must present it as storage attachments with durable storage names, not as ordinary memory filters.
- The editor shows an explicit retrieval toggle plus checkboxes for storage attachment. The toggle is disabled when no storage is attached, and saving must persist both `persistentSkillStorageIds` and `persistentSkillStorage.enabled`.
- The detail panel summarizes attached storages and the opt-in state. Empty state copy should say no storage is attached rather than implying memory is unavailable.
- All add/remove/attach controls need visible labels, keyboard focus rings, and non-hover-only state. Storage chips may truncate long names, but the visible section title and status must remain readable on mobile.
- Settings > Agents owns the project storage management and per-agent attachment controls. The regression in `tests/dashboard/v2/settings-agents-persistent-skills.test.tsx` verifies that attachment edits generate `updateAgentPreset` payloads containing both `persistentSkillStorageIds` and `persistentSkillStorage.enabled`, while self-reflection criteria edits remain in the project settings save payload.
- Backend ownership and MCP/runtime behavior are documented in [Agent Preset Foundation](../architecture/agent-preset-foundation.md#data-model) and [MCP Tools and Contracts](../mcp/tools-and-contracts.md#search_skills-retrieval-tool).

## MCP Access
- Missing per-agent MCP access must display as default-deny: Code UX built-in tools are off, and custom MCP links are shown independently from built-in Code UX access.
- The editor must not enable Code UX directly from the inactive chip. It should open the MCP manager so the visible risk warning is presented before the user grants built-in tools.
- Enabling Code UX from the manager for the dashboard reply agent enables the built-in MCP surface plus `scheduler_code_ux`.
- Enabling Code UX from the manager for non-dashboard agents starts with every built-in tool represented explicitly and `scheduler_code_ux` disabled by default. Planning, coding, QA, CI repair, merge-conflict, and other non-chat agents need stronger visible warning copy because Code UX scheduler access can create agent-owned wakeups during operational workflows.

## Empty States
For empty states on the Agents page, avoid generic `<EmptyState />` implementations. Instead, use tailored rounded containers (`rounded-[1.9rem]`), dashed borders (`border-dashed border-black/[0.08]`), and a highly blured backdrop (`backdrop-blur-2xl`) that houses an oversized icon container (`h-16 w-16 bg-signal-500/10 text-signal-600 shadow-sm ring-1 ring-slate-900/5`).

## Responsive Layouts
- Use `flex-col-reverse` for primary-secondary layouts so side panels (like roster) stack below editors on small viewports.
- Apply `min-w-0` aggressively in `flex` containers and flex children where text truncation is required.
- Ensure action button clusters wrap natively using `flex-wrap` and preserve alignment.
