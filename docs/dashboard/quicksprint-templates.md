# Quicksprint Templates

Quicksprint turns a reusable template into a sprint goal prompt, then sends that prompt through the normal sprint planning flow.

The route and model controls share Sprint Composer routing metadata. Their default option reflects the effective `planning` route mapping, including a pinned provider instance and route-specific model override, instead of blindly showing the worker default. When an operator selects a provider instance and model explicitly, the dashboard preserves the instance id for the select control but sends the underlying CLI provider type plus the selected model to planning, so the model is invoked through the intended provider runtime.

This page documents the built-in template catalog, how the dashboard organizes it, and the authoring rules for high-quality templates.

## Source Of Truth

Default file-backed templates live in:
- `.code-ux/quicksprints/templates/*.md`

Project overrides and custom project templates live in:
- `<project>/.code-ux/quicksprints/templates/*.md`

Home-level overrides live in:
- `~/.code-ux/quicksprints/templates/*.md`

The TypeScript catalog in `src/domain/quicksprint/quicksprint-catalog.ts` is now only a compatibility fallback that loads the bundled `.code-ux/quicksprints/templates` files.

The shared template record contract lives in:
- `src/contracts/quicksprint-types.ts`

The view-model state derivation logic for the Quicksprint panel, including template grouping, purpose filtering, and prompt composition, lives in:
- `dashboard/src/v2/lib/quicksprint-panel-state.ts`

## File Format

Quicksprint templates use the same editable mixed Markdown pattern as agent files:

```md
---json
{
  "id": "qs-example",
  "name": "Example Audit",
  "description": "Reusable audit template.",
  "icon": "Sparkles",
  "category": "engineering",
  "categoryColor": "#22c55e",
  "defaultTaskCount": 5
}
---
Write the full agentInstructionMarkdown body here.
```

Everything above the second `---` is JSON metadata. Everything below it is the prompt body persisted as `agentInstructionMarkdown` in the runtime API.

Adding a new `.md` file to a resolved template directory is enough for it to appear in Quicksprints. The file must include at least a stable `id`, `name`, and a non-empty Markdown body. Unsupported file extensions, including `.json`, are ignored.

## Dashboard Behavior

The Quicksprint panel presents default and custom templates in one shared browse rail. Template cards use the same stats-surface design language as the dashboard telemetry cards, with taller premium surfaces, high-contrast titles, category/subtask chips, a dedicated launch control, and separate icon controls for edit/delete actions. Cards label their source as `Default Template` or `Custom Template`; custom cards can still be edited, and both sources can be removed from the current project's catalog.

Default templates are organized by `purpose`. The purpose selector narrows the visible default templates while custom/project templates remain in the same rail.

Projects can also have generated or project-local templates without any active built-in defaults. In that case the dashboard shows the populated custom/project rail directly, so browse mode never opens on an empty default catalog.

The browse panel renders templates as a horizontally scrollable rail so large catalogs stay readable without cutting off rows on smaller viewports. The rail keeps template cards arranged in exactly two rows by default, then continues horizontally for overflow items instead of adding a third visible row or forcing the whole page to widen. The panel does not claim its own vertical scroll area, and vertical wheel/trackpad gestures over the template area are handed to the surrounding dashboard page scroller so normal page scrolling still works.

The rail exposes left and right controls for page-style scrolling. These controls move the rail contents without changing the selected template or interfering with keyboard focus. Horizontal wheel, trackpad, and touch movement can still scroll the rail directly. Vertical wheel movement over the rail is forwarded to the surrounding dashboard page scroller, so the composer never traps normal page scrolling.

Template selection, back navigation, template editor entry, and delete decisions keep the operator's context visible. Browse and configure views move focus to their heading when they appear, selected templates keep a static selected cue when returning to browse, destructive template deletion opens the shared confirmation dialog instead of a browser-native prompt, and phase changes are announced through a polite status region instead of relying on motion alone.

This browse-slider treatment only changes how templates are discovered and selected. Template execution still uses the same quicksprint planning flow, subtask-count controls, and `Plan Only` / `Plan & Start` behavior as before.

The execution sidebar now lets operators raise the subtask count up to 30 or switch on `No limit`, which disables the slider and asks the planner to choose an appropriate task count for the run. The subtask control is backed by a native range input for keyboard and assistive-technology support, while preserving the custom visual track. Saved template defaults outside the visual 1-30 range are clamped when loaded into the dashboard composer or template editor so the thumb, fill, and submitted task count stay consistent.

The combined prompt preview is a real expandable region tied to its trigger with `aria-expanded` and `aria-controls`. It uses stable max-height behavior, keeps the prompt text selectable and scrollable when expanded, and shows a non-animation selected/open cue so reduced-motion users receive the same state information.

During quicksprint planning, route/model selectors, prompt edits, task controls, back navigation, and competing submit actions are disabled until the active request finishes or is cancelled. The sidebar and planning overlay both expose pending state, elapsed time, ETA/progress feedback, and cancellation controls; cancellation and starting a fresh quicksprint are announced as operator-requested feedback while preserving the existing execution semantics.

The template editor's icon and color pickers use the dashboard interaction tokens for open, selection, and control feedback. Picker triggers and options expose stable accessible names and selected state, close with Escape or outside click, and keep static selected cues when reduced motion is enabled.

Current built-in purpose set:
- `Fullstack JS App`

That purpose selector is intentionally future-facing. Additional built-in sets can be added later for other language and product families without redesigning the Quicksprint browse flow.

## Built-In Templates

The current `Fullstack JS App` purpose set ships with six built-ins:
- `Code Quality & Performance Audit`
- `Security Vulnerability Scan`
- `UI Usability & Accessibility Audit`
- `UI - Design Improvements`
- `UI - Responsive Layout Improvements`
- `UI - Interactions & Design Improvements`

These templates are designed to produce strong planning subtasks without assuming any repository-specific file layout.

## Prompt Design Rules

Built-in Quicksprint prompts should follow these rules:
- Stay project-agnostic. Do not hardcode folder names, file globs, or stack-specific path assumptions.
- Inspect the actual architecture first, then adapt the audit to what exists.
- Cover the full surface area of the concern instead of a small handful of common checks.
- Produce implementation-ready subtasks rather than vague advice.
- Prefer high-leverage, cohesive tasks over scattered low-value nits.
- Avoid arbitrary hardcoded UI values unless they are justified by the existing design system or a real standard.
- Use preview, screenshots, storybook, or browser tooling when available for UI-focused templates, but degrade cleanly to code inspection when those surfaces are unavailable.

## Output Expectations

Every Quicksprint prompt should drive the planner toward subtasks that include:
- affected file or files
- the current issue or gap
- why it matters
- the desired end state
- the concrete implementation approach
- verification work

The runtime appends the exact subtask count for the specific execution, so templates should focus on quality and scope, not on hardcoding a fixed number of tasks inside the prompt body.

## Override Resolution

Templates are resolved by stable `id` in this order:
- project `.code-ux/quicksprints/templates`
- home `.code-ux/quicksprints/templates`
- bundled `.code-ux/quicksprints/templates`
- TypeScript fallback catalog

The first template for an id wins. This lets a project override a home/default template by writing a mixed Markdown file with the same `id`, while home-level files can override bundled defaults for all projects.

Deleting a custom template removes its project file. Deleting a default template writes a project-local hidden marker with the same template id, so the bundled or home template disappears for that project without deleting the shared asset globally. Removing that marker from the project template directory restores the default template.
