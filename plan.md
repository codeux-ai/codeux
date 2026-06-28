1. **Wire the chat mode tablist (`ChatPageShell.tsx` and `ChatPage.tsx`)**
   - Provide a unique ID to the tab panel (already `chat-panel`) in `ChatPage.tsx` (already there).
   - In `ChatPageShell.tsx`, update the `role="tab"` buttons to have IDs `tab-threads` and `tab-invocations`, and ensure their `aria-controls` map to `chat-panel`. Also, update `tabIndex={0}` for selected and `-1` for unselected, and implement `onKeyDown` for roving tabIndex.
   - Update `chat-panel` in `ChatPage.tsx` to include `aria-labelledby` linking to the active tab ID.
   - (Done via scripts but we'll include this explicitly in the plan). Wait, I'll remove `aria-label="Message history"` from `ChatPage.tsx` or make it `aria-label` only when not controlled? Wait, `aria-labelledby` will override `aria-label`. We should ensure the role is correct.
   - Wait, `role="log"` shouldn't use `aria-labelledby` pointing to a tab. Usually, a tab panel has `role="tabpanel"`. Wait, the issue says:
     `Wire the chat mode tablist with unique tab IDs and panel IDs, correct aria-controls, aria-labelledby, and roving/arrow-key behavior where appropriate.`
     AND
     `Mark message history as a named log/feed region with polite announcements for new messages and avoid reading every existing message as a new live update on initial render.`

Let's check the issue description carefully:
`1. Wire the chat mode tablist with unique tab IDs and panel IDs, correct aria-controls, aria-labelledby, and roving/arrow-key behavior where appropriate.`
`2. Mark message history as a named log/feed region with polite announcements for new messages and avoid reading every existing message as a new live update on initial render.`

If we make `chat-panel` a `role="log"`, then a `tab` shouldn't control a `log`. A tab should control a `tabpanel`.
Actually, `chat-panel` could be inside a `tabpanel`, or `chat-panel` itself can be `role="tabpanel"`, and inside it there is a `role="log"`. Let's wrap the chat history in a `role="log"` that is *inside* the `tabpanel`.
Wait, right now `ChatPage.tsx` has `id="chat-panel" role="log"`. I should change `chat-panel` to `role="tabpanel"` and inside it add `<div role="log" aria-live="polite" aria-atomic="false" aria-relevant="additions" aria-label="Message history">` but wait, `aria-live="polite"` might read the whole thing on mount if we're not careful. We can conditionally add `aria-live="polite"` only after initial render, or just use an `aria-live` region outside for announcements and keep `role="log"` without `aria-live`. Or use `aria-live="polite"` but avoid rendering it until mounted.
Wait, the issue states: "avoid reading every existing message as a new live update on initial render." We can do this by using a visually hidden `aria-live="polite"` region that only announces *new* messages, or by dynamically setting `aria-live` to polite after the first render.
Actually, if we put `role="log" aria-relevant="additions"` it might still read on mount in some screen readers. Standard practice to avoid reading on mount is to toggle `aria-live="polite"` on after mount.
Let's look at `dashboard/src/v2/ChatPage.tsx`.

3. **Message Bubbles (`ChatMessageBubble.tsx` and `InvocationMessageBubble.tsx`)**
   - Ensure sender, timestamp, delivery status, etc. are accessible. `InvocationMessageBubble.tsx` already has `<span className="sr-only">From {senderName}...</span>` but we need to check `ChatMessageBubble.tsx`.

4. **Working Bubble & System Bubble**
   - Check status text for `WorkingBubble.tsx`.
   - Ensure `TruncatedSystemBubble.tsx` has proper text and aria controls.

5. **Thread/Invocation lists & ChatThreadHeader**
   - Make sure they use `aria-label` or `sr-only` for status/pending counts.

Let's review the code we modified.
