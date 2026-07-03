# Quicksprint Templates

Quicksprint turns a reusable template into a sprint goal prompt, then sends that prompt through the normal sprint planning flow.

The route and model controls share Sprint Composer routing metadata. Their default option reflects the effective `planning` route mapping, including a pinned provider instance and route-specific model override, instead of blindly showing the worker default.

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

The Quicksprint panel separates templates into two groups:
- `Default Templates`
- `Custom Templates`

Default templates are now organized by `purpose`.

The browse panel renders template groups as horizontally scrollable rails so large catalogs stay readable without cutting off rows on smaller viewports. Browse rails keep template cards arranged in exactly three rows by default, then continue horizontally for overflow items instead of adding a fourth visible row or forcing the whole page to widen.

Each rail exposes left and right controls for page-style scrolling. These controls move the rail contents without changing the selected template or interfering with keyboard focus. Touch and trackpad users can swipe the rail directly with normal horizontal scrolling, so mobile behavior preserves swipe scrolling rather than replacing it with control-only navigation. Trackpad scrolling works the same way.

This browse-slider treatment only changes how templates are discovered and selected. Template execution still uses the same quicksprint planning flow, subtask-count controls, and `Plan Only` / `Plan & Start` behavior as before.

The execution sidebar now lets operators raise the subtask count up to 30 or switch on `No limit`, which disables the slider and asks the planner to choose an appropriate task count for the run.

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
