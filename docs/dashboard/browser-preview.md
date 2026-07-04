# Browser Preview

The browser preview provides an integrated environment for interacting with running sprint containers directly from the dashboard.

## Accessibility Expectations
- Interactive elements (session menus, sliders, actions) must be fully keyboard accessible.
- Iframes and embedded views must have descriptive titles indicating their purpose and target.
- Live regions should transparently report state changes (starting, stopping, rebuilding, error) without overwhelming screen readers.
- Disruptive actions (rebuild, stop) should have clear labels.
- Hidden slider controls must become visible when they or their container receive keyboard focus.

## File Browser Workbench

The Files route uses the same workbench discipline as browser preview: session controls, tree/list navigation, and the viewer are distinct bordered surfaces with consistent dividers. The file tree panel exposes a labelled filter input and keeps folder/file rows keyboard reachable; selected files, empty directories, and highlighted search matches must remain visible without introducing horizontal page overflow.

The viewer header always shows the selected path or an empty-selection label. Long paths and changed-file names wrap inside their panel, while Monaco keeps its own editor scrolling for file contents and diffs. File, diff, loading, binary, unavailable, and error states expose labelled regions so tests and assistive technology can identify the current inspection state.

Changed files keep semantic status metadata visible for added, modified, deleted, and renamed entries. Addition/deletion counts, old paths for renames, branch comparison labels, and diff layout controls should not be hidden to simplify responsive layouts.
