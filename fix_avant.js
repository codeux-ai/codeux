// Wait! If there is no active:scale or hover:-translate-y-px in AvantgardeSelect, what else could be missing?
// "Ensure tooltip/popover and collapsible interactions support keyboard parity (focus open, Escape close where applicable, deterministic focus return) and avoid hover-only discoverability."
// In AvantgardeSelect, there's `Escape close where applicable, deterministic focus return`.
// When closing via outside click, or when closing via `onChange`, does it return focus?
// Let's check `onChange` or `onClick` on an option.
