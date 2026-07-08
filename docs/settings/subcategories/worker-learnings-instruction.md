# Worker Learnings Instruction

Defines the prompt appended to worker tasks so useful lessons are captured for memory processing.

## What It Controls

The text area controls exactly what workers are asked to observe and write into the temporary learnings file.

The default template asks workers to keep reusable lessons under `## Category:` sections and optionally add a `## Self Reflection Rating` section. Rating sections use `Overall: N/5` plus bullets such as `- Implementation: 4/5 - note`; they are stored separately from memory entries.

## Recommended Defaults

Keep instructions specific to reusable engineering lessons and avoid asking workers to record secrets.

## Risks And Gotchas

Overbroad instructions can capture noisy or sensitive details.

## Dashboard Link

Open this subcategory from the dashboard docs route at `/docs/user-dashboard-settings#worker-learnings-instruction`. The Settings card header links to the matching published docs anchor.

## Related Docs

- [Memory Architecture and Search](../../dashboard/memory.md)
- [Instruction Template System](../../instructions/markdown-template-system.md)
