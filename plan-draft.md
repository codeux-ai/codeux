1. **Extract shared interfaces and helpers to `src/repositories/connection-chat/conversation-query-utils.ts` (or put them in `conversation-thread-query.ts` and `conversation-message-query.ts`)**
   Move `ThreadRow`, `MessageRow`, `toNumber`, `visibleConversationMessageFilter` into shared places or duplicate minimally if they are local types. Wait, it's better to just create the new query files and move the functions/types there and import them back into `ConnectionChatRepository`. Or maybe keep types in `connection-chat-repository.ts` and just export them for the new query functions.

2. **Create `src/repositories/connection-chat/conversation-thread-query.ts`**
   - Extract `mapThreadRow` logic.
   - Implement `getThread(db: DatabaseAdapter, threadId: string): ConversationThreadRecord`.
   - Update `ConnectionChatRepository.getThread` to use this new function.
   Wait, `ConnectionChatRepository` already has `getThread(threadId: string): ConversationThreadRecord`. Wait, the requirement says "Extract thread/message read queries into helper modules and expose targeted repository methods such as single-thread reload and first-reply-after-message lookup. Keep existing list APIs intact...".
   - Okay, maybe I need to move the implementation of `getThread` from `ConnectionChatRepository` into `conversation-thread-query.ts`.
   - `ConnectionChatRepository` will just call `getThread(this.db, threadId)`.

3. **Create `src/repositories/connection-chat/conversation-message-query.ts`**
   - Extract `mapMessageRow` logic.
   - Implement `listMessages(db, threadId, options)`.
   - Implement `getFirstReplyAfterMessage(db: DatabaseAdapter, threadId: string, messageId: string, options?: { includeHidden?: boolean }): ConversationMessageRecord | null`.
   - `ConnectionChatRepository` will expose `getFirstReplyAfterMessage(threadId: string, messageId: string, options?: { includeHidden?: boolean })` which calls the new query helper.

4. **Update `src/repositories/connection-chat-repository.ts`**
   - Add `getFirstReplyAfterMessage` which uses the helper.
   - Refactor `getThread`, `listMessages`, `requireThread`, `requireMessage` to use the helper functions. This ensures we don't have duplicated row mappers and CTE logic.
   - Wait, `requireThread` already uses a big query with CTE. We can extract it to `conversation-thread-query.ts` as `requireConversationThreadQuery(db: DatabaseAdapter, threadId: string)`.

5. **Update tests**
   - Add tests for `getFirstReplyAfterMessage` in `tests/backend/repositories/connection-chat-repository.test.ts`.

6. **Reflect changes in documentation**
   - Update `docs/architecture/chat-thread-runtime.md`.
