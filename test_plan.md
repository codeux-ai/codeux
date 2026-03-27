I need to implement the following files:
- dashboard/src/v2/components/chat/ChatIdentityAvatar.tsx
- dashboard/src/v2/components/chat/ChatRouteBadge.tsx
- dashboard/src/v2/components/chat/ChatActivityWidget.tsx
- dashboard/src/v2/components/chat/ChatSurfaceCard.tsx
- dashboard/src/v2/lib/chat-appearance.ts
- tests/dashboard/lib/chat-appearance.test.ts
- tests/dashboard/v2/ChatIdentityAvatar.test.tsx
- tests/dashboard/v2/ChatActivityWidget.test.tsx

Implementation requirements:
1. Create `chat-appearance.ts`: a display helper layer that maps persisted route/runtime metadata into concrete visual states, including animated boat icon for virtual container-backed CLI routes, animated `J` motif for Jules/external API routes.
2. Build reusable avatar and badge components for `dashboard_user`, `system`, connected workers, virtual workers, and invocation roles. `ChatPage` can stop hard-coding `Sparkles` and `UserCircle2`.
3. Add a generic activity widget component for planning, waiting-for-reply, compaction, route-transition states, including accessible motion and stable skeleton/loading behavior.
4. Keep animation performant and respectful of reduced-motion expectations.
5. Reuse centralized appearance helper instead of scattering provider-to-icon logic across cards and bubbles.

Wait, I need to see what properties `ChatSurfaceCard` would have. Maybe I should check `dashboard/src/v2/ChatPage.tsx` lines around 300 to see what the current code looks like to see how I can integrate the avatar, but the task says to add these components.
