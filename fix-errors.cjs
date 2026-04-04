const fs = require('fs');

// 1. Fix hook missing messagesRef and composerRef definitions
let hook = fs.readFileSync('dashboard/src/v2/hooks/use-chat-page-data.ts', 'utf8');

// Wait, actually, the ref manipulation for messages scroll and composer height
// is visual and DOM-related, so it should NOT be in the hook, it should be passed
// as refs from the component, or the handler should just be in the component.

// In the original ChatPage.tsx, `handleSend` uses `composerRef` to reset height.
// We can just omit `composerRef` from the hook entirely if we pass a callback or return a value,
// but an easier way is to pass `composerRef` and `messagesRef` to `useChatPageData` as arguments,
// or move the DOM manipulation to the component. Let's pass them as arguments to `useChatPageData`!

hook = hook.replace(
  'export const useChatPageData = () => {',
  'import { type RefObject } from "preact";\n\nexport const useChatPageData = (options?: { composerRef?: RefObject<HTMLTextAreaElement>; messagesRef?: RefObject<HTMLDivElement> }) => {'
);
hook = hook.replace(/messagesRef\.current/g, 'options?.messagesRef?.current');
hook = hook.replace(/composerRef\.current/g, 'options?.composerRef?.current');

fs.writeFileSync('dashboard/src/v2/hooks/use-chat-page-data.ts', hook);


// 2. Fix ChatPage.tsx missing `threadIndex` and `invocationIndex` which were used in render functions
// Actually, `threadIndex` and `invocationIndex` were only built inside ChatPage and now they are in the hook.
// Let's just export them from the hook too, or replace `threadIndex.get(id)` with `threads.find(t => t.id === id)`.

// Let's export threadIndex and invocationIndex from the hook
hook = hook.replace(
  '    workerOptions,',
  '    workerOptions,\n    threadIndex,\n    invocationIndex,'
);
fs.writeFileSync('dashboard/src/v2/hooks/use-chat-page-data.ts', hook);

let chatPage = fs.readFileSync('dashboard/src/v2/ChatPage.tsx', 'utf8');
chatPage = chatPage.replace(
  '    workerOptions,',
  '    workerOptions,\n    threadIndex,\n    invocationIndex,'
);
chatPage = chatPage.replace(
  ' = useChatPageData();',
  ' = useChatPageData({ composerRef, messagesRef });'
);
fs.writeFileSync('dashboard/src/v2/ChatPage.tsx', chatPage);
