1. **ChatThreadHeader component**: Create `ChatThreadHeader.tsx` which will render the thread header UI. It will take the currently selected thread, worker options, assigning state, compacting state, and callbacks for assigning and compacting. It will display the thread title, message count, active continuation session, and replay-required warnings. It will also expose compact controls.
2. **ChatPage changes**: Update `ChatPage.tsx` to use the new `ChatThreadHeader` component instead of the bare `Worker:` select.
    - Fetch and compute the `WorkerOption` array based on the `execution` snapshot (similar to how `TopNav` does it) and the project's effective `WorkerRoutingPreference`.
    - Handle assigning thread routes using `updateThreadRoute`.
    - Handle compacting thread sessions using `compactThreadSession`.
    - Automatically inherit the project's default worker route for new threads or unassigned threads.
3. **Tests**: Update or write tests in `chat-thread-header.test.tsx`.
4. **Pre-commit**: Run tests, typecheck, lint, and build.
