# Dashboard Interaction Patterns

The running dashboard uses shared contracts for confirmations, dirty drafts, asynchronous feedback, keyboard operation, focus, and reduced motion. Route pages keep their feature-specific behavior; these rules define the common operator experience.

## Shared contracts

- Dirty editors keep the current draft when navigation is canceled or Escape is pressed. Saving or explicitly discarding continues to the retained destination once.
- Destructive actions open a named confirmation dialog that contains focus, supports Escape, suppresses duplicate confirmation while pending, and restores focus to the initiating control.
- If a successful mutation removes that initiating control, focus moves to the next logical item, the previous item, or a named list/page fallback.
- Pending controls remain visibly and programmatically busy. Retryable failures stay attached to the affected operation and provide a keyboard-reachable retry action.
- Nodes, tabs, lists, and selectors expose their state with roles, selected/pressed state, focus, and concise live announcements instead of relying on pointer movement or color.
- Reduced motion removes optional movement, not information. Selection, pending state, progress, errors, retry controls, and live-region messages remain visible immediately.

These contracts apply across [Node Flows](./node-flows.md), [Scheduler](./scheduler.md), [Custom Dashboards](./custom-dashboards.md), [Agents](./agents.md), [Projects](./projects.md), [Knowledge](./knowledge.md), [Browser Preview](./browser-preview.md), and [Chat](./chat.md). Each route page owns its detailed workflow.

## Browser acceptance

The repository acceptance suite uses an approved isolated local project and generic records. It verifies dirty-editor cancellation and continuation, confirmation focus and Escape behavior, duplicate-action suppression, pending/error/retry feedback, logical focus after deletion, keyboard node movement, and reduced-motion equivalence. It does not dispatch experimental work or select a live project.

For the contributor checklist, see [Dashboard Accessibility Quality Audit](./accessibility-quality-audit.md).
