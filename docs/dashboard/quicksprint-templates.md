# Quicksprint Templates

Quicksprint turns a reusable template into a sprint goal prompt, then sends that prompt through the normal sprint planning flow.

This page documents the built-in template catalog, how the dashboard organizes it, and the authoring rules for high-quality templates.

## Source Of Truth

Built-in templates live in:
- `src/domain/quicksprint/quicksprint-catalog.ts`

Custom project templates live in:
- `<project>/.quicksprints/*.json`

The shared template record contract lives in:
- `src/contracts/quicksprint-types.ts`

## Dashboard Behavior

The Quicksprint panel separates templates into two groups:
- `Default Templates`
- `Custom Templates`

Default templates are now organized by `purpose`.

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
