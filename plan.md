1. **dashboard/src/v2/lib/chat-appearance.ts**:
Create functions to resolve appearance (icon, label, classes) for Chat Avatars, Badges, and Activity Widgets based on route/role information. E.g., handling roles like `dashboard_user`, `system`, and mapping connected workers/virtual providers/invocations to appropriate visuals.

2. **dashboard/src/v2/components/chat/ChatIdentityAvatar.tsx**:
Implement the avatar component using `chat-appearance.ts`. It takes props like `{ role?: "user" | "assistant" | "system" | "dashboard_user" | "connection", providerId?: string, isJules?: boolean, isVirtual?: boolean, isCli?: boolean }`.

3. **dashboard/src/v2/components/chat/ChatRouteBadge.tsx**:
Implement the badge component to render the routing target label (e.g., "Jules", "Claude", "Local Agent").

4. **dashboard/src/v2/components/chat/ChatActivityWidget.tsx**:
Implement the activity widget for states like "planning", "waiting", "compaction", or "route transition", showing a nice animated skeleton/pulse.

5. **dashboard/src/v2/components/chat/ChatSurfaceCard.tsx**:
Refactor the existing message bubble logic into `ChatSurfaceCard.tsx` that wraps children. It provides the rounded borders and shadowing based on the sender direction (`isUser={true/false}`). Wait, the existing code uses hardcoded classes for User vs Dashboard. I will create `ChatSurfaceCard` that accepts `isUser: boolean` and `children`.

6. **dashboard/src/v2/ChatPage.tsx**:
Update `ChatPage.tsx` to use these new components instead of `Sparkles`, `UserCircle2`, and inline div wrappers. Update `MessageBubble`, `InvocationMessageBubble`, and `WorkingBubble` to use `ChatSurfaceCard`, `ChatIdentityAvatar`, and `ChatActivityWidget`.

7. **tests/dashboard/lib/chat-appearance.test.ts**:
Write test validating deterministic selection of avatars and badges.

8. **tests/dashboard/v2/ChatIdentityAvatar.test.tsx** & **tests/dashboard/v2/ChatActivityWidget.test.tsx**:
Write UI component tests checking that they render correctly and handle different inputs.

9. Build and test.
