Ah, `CreateSystemConversationMessageInput` is in `src/repositories/connection-chat-repository.ts`.
Wait, there's `postSystemMessage` and `postDashboardMessage` in `connection-chat-repository.ts`. But what about `WorkerInboxReplyService`? Does it post messages? No, it returns `GenerateDashboardReplyResult` which is used by MCP listener to `postListenReply`.

So in `chat-thread-runtime-service.ts`, we need to save the virtual worker's reply.
We can use `connectionChatRepository.postSystemMessage(projectId, { threadId, bodyMarkdown: reply })`. Wait, but authorType will be `system`.
If we want authorType `connection`, we could use `postListenReply`, but it requires `connectionKey`.
Let's look at `postSystemMessage`. It inserts `author_type = 'system'`, `direction = 'connection_to_dashboard'`.
This is exactly what we want for a VIRTUAL provider! Wait, the objective says: "Emit execution invocation records, provider-usage telemetry, and structured system/status messages while preserving the current MCP inbox flow for live listeners."

Actually, I should create a new plan and request review.
