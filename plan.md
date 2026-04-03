1. **Create `chat-cache-updates.ts`**:
   - Extract cache update logic like `upsertMessage` into this file.
   - Also add update functions for threads and connections as needed by realtime events.

2. **Create `use-chat-page-controller.ts`**:
   - Move state management (threads, invocations, messages, selected items, loading states) out of `ChatPage.tsx` into this hook.
   - Move data fetching (`fetchConversationThreads`, `ensureMessagesLoaded`, `refreshThreads`, etc.) into this hook.
   - Move actions (`createThreadForCompose`, `handleSend`, `handleDeleteThread`, `handleAssignRoute`, `handleCompactThread`) into this hook.
   - Move realtime subscription setup (`subscribeToDashboardRealtime` and its handlers) into this hook, using `chat-cache-updates.ts` helpers.

3. **Refactor `ChatPage.tsx`**:
   - Remove the extracted state and logic.
   - Consume `useChatPageController`.
   - Keep manual UI states like `chatMode`, `input`, `composerRef`, `messagesRef`, and the UI rendering structure.

4. **Verify Tests**:
   - Ensure `tests/dashboard/v2/chat-page.test.tsx` and `tests/dashboard/v2/chat-page-shell.test.tsx` pass. Check if they need any adjustments.

5. **Pre-commit checks**: Ensure all standard pre-commit gates pass (linting, typecheck, tests).

