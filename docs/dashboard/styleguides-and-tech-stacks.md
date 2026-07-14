# Styleguides and Tech Stacks

Code UX has two related dashboard concepts for project guidance:

- **Techstacks** classify the project implementation stack and application kind. They are managed in Settings -> Techstacks.
- **Guidance** selects reusable worker instructions for tech-stack expectations and visual styleguide direction. It is managed in Settings -> Guidance and mirrored in the top navigation.

This page focuses on the Guidance workflow. See [Configuration and Storage](../settings/configuration-and-storage.md) for persistence details and [Techstacks](../settings/techstacks.md) for the project classification catalog.

## Guidance Catalogs

Guidance uses two catalogs:

- **Tech Stack Guidance** entries describe implementation expectations such as framework, typing, module boundaries, and testing posture.
- **Styleguide** entries describe product design, layout, interaction, accessibility, and visual quality expectations.

Both catalogs include protected built-in entries plus custom entries. Every entry has a stable `id`, `name`, `summary`, and `instructionMarkdown`. Built-in entries can be selected but not edited or deleted. Custom entries can be added, edited, deleted, and selected from the same controls.

Both selectors include the stable `none` entry. Selecting `None` persists `none` and tells prompt builders to omit extra guidance for that catalog. This keeps repository instructions and the task prompt as the only guidance source when a project does not need a reusable tech-stack or styleguide instruction set.

## Dashboard Workflow

The top navigation shows the active project's effective tech-stack guidance and styleguide selectors beside global search. The selectors are disabled until a project is selected and effective settings are loaded.

Selecting an entry in either header dropdown saves a project-level `designGuidance` override immediately. Choosing `None` saves the stable `none` id. Each dropdown also has footer actions:

- **Add Tech Stack** opens Settings -> Guidance at `/config?category=guidance#guidance` so a custom tech-stack guidance entry can be added.
- **Add Styleguide** opens the same Guidance settings area for a custom styleguide entry.
- **Manage Guidance** opens the Guidance settings area for reviewing selections, visibility, and custom entries.

The Settings -> Guidance page edits the active settings scope. System scope updates the inheritable default guidance, project scope updates the active project override, and sprint overrides participate in effective resolution when present. The effective value is what the header selectors display and what planning/setup prompts use.

## Hiding Default Styleguides

`hideDefaultStyleguides` hides built-in styleguides from dashboard selectors while preserving `None` and custom styleguides. It does not delete built-in catalog entries and does not clear the saved selection.

If a hidden built-in styleguide is already selected, the settings panel preserves the selected id and warns that the active default is hidden. Choose `None`, select a custom styleguide, or turn defaults back on to change the selection from the visible selector.

Tech-stack guidance defaults are not hidden by this control.

## Project Defaults

The base `designGuidance` defaults are:

- `selectedTechStackId: "none"`
- `selectedStyleguideId: "none"`
- `hideDefaultStyleguides: false`
- no custom entries

Every imported, new local, and new remote project starts with explicit project overrides selecting `none` for both Tech Stack Guidance and Styleguide. This keeps project creation independent from system-level guidance selections and prevents create-time caller selections from silently applying reusable instructions before an operator reviews the project.

Project creation preserves unrelated guidance fields, including custom catalog entries and `hideDefaultStyleguides`, while normalizing both selected ids to `none`. An operator can select guidance from the top navigation or Settings -> Guidance after the project has been added; sprint overrides can still change the effective selection for an individual sprint.

## Prompt Effects

Planning and Project Setup resolve the effective project settings before building prompts. Selected non-`none` tech-stack and styleguide entries are added as a compact `Project Guidance` section. `None` selections do not inject catalog entry instructions, so newly added projects do not receive reusable tech-stack or styleguide instructions by default.

When the styleguide remains `none`, Project Setup still asks the setup agent to inspect the repository's existing styling, brand assets, design tokens, components, layouts, and interaction patterns before proposing a project-specific styleguide. This setup-only discovery notice is included even when tech-stack guidance is also `none`; Planning prompts continue to omit inactive `none` selections entirely.

## Related Docs

- [Dashboard Guide](./dashboard-guide.md)
- [Guidance Settings](../settings/guidance.md)
- [Configuration and Storage](../settings/configuration-and-storage.md)
- [Project Initialization](./project-initialization.md)
