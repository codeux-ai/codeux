# Guardrails

Caps repeated agent jobs so runaway planning, coding, CI, merge, clarification, or remediation loops stop predictably.

## What It Controls

Per-job caps and on-limit actions determine whether Code UX blocks, waits, warns, or continues.

## Recommended Defaults

Keep guardrails enabled and use block-and-escalate for expensive or destructive job types.

## Risks And Gotchas

Very high caps can burn provider quota; very low caps can stop recoverable work too early.

## Dashboard Link

Open this subcategory from the dashboard docs route at `/docs/user/dashboard/settings#guardrails`. The Settings card header links to the matching published docs anchor.

## Related Docs

- [Quality Guardrails](../../architecture/quality-guardrails.md)
- [Operations Runbook](../../operations/runbook.md)
