1.  **Enhance `dashboard/src/v2/lib/motion/task-card-motion.ts`**
    - Add logic to handle `isDragging` state. When `isDragging` is true, set the opacity to `0.5`, elevate the element (`z-index: 50`), and scale it slightly up. When `isDragging` becomes false, apply a "settle" animation (scale down to normal, slide back to normal position) unless `isReducedMotion` is true.

2.  **Update `dashboard/src/v2/components/tasks/KanbanTaskCard.tsx`**
    - Add `draggable` and `onDragStart`, `onDragEnd` event handlers.
    - Set `draggable={!isReducedMotion}` to allow dragging unless reduced motion is active (or always `true` but just avoid animations, HTML5 dnd supports draggable everywhere).
    - Manage local state `isDragging` and pass it to `useTaskCardMotion`.
    - Accept an `onDragStart` and `onDragEnd` prop from `TasksPage`.

3.  **Update `dashboard/src/v2/TasksPage.tsx`**
    - Implement a basic HTML5 drag-and-drop mechanism for reordering.
    - Add `onDragOver`, `onDragEnter`, `onDragLeave`, `onDrop` handlers to the columns/lists.
    - Track the currently dragged task (`draggedTaskId`).
    - Render a "drop target placeholder" gap if a dragged item hovers over a valid drop target.
    - On drop, determine the new position/status.
    - Dispatch `updateTask` with the new `status` and `sortOrder`.
    - Optimistically update the UI to reflect the change immediately.

4.  **Verification**
    - Run `pnpm run typecheck:dashboard`.
    - Run Kanban tests under `tests/dashboard`.
    - Manually verify drag, lift affordance, placeholder, settle animation, and reduced motion behavior.
