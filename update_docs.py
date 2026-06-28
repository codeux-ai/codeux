with open('docs/dashboard/design-system-chat.md', 'a') as f:
    f.write("\n## Accessibility\n")
    f.write("- **Tab Navigation**: The mode switcher is a `role=\"tablist\"` with unique `id`s for `role=\"tab\"` elements, matching `aria-controls` to the underlying `role=\"tabpanel\"` and `aria-labelledby` back to the tab. Roving `tabIndex` and arrow-key navigation are supported.\n")
    f.write("- **Message History**: The message lists use `role=\"log\"` mapped to `aria-live=\"polite\"` only when newly loaded to avoid repeating the entire history on mount. Regions use clear `aria-label` names.\n")
    f.write("- **Screen Reader Clarity**: Status dots, metadata icons, and delivery status badges must be accompanied by visually hidden (`sr-only`) descriptive text (e.g., `Status: Replay Required`, `Error: Rate limit`) so screen readers provide complete context.\n")
    f.write("- **Interactive Widgets**: Bubbles, truncations, and expanding blocks must preserve clear semantic roles (`button`, `region`) and expansion states (`aria-expanded`).\n")
