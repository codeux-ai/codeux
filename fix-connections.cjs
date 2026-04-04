const fs = require('fs');
let chatPage = fs.readFileSync('dashboard/src/v2/ChatPage.tsx', 'utf8');

chatPage = chatPage.replace(
  '    threadsLoading,\n    threadMessagesLoading,',
  '    threadsLoading,\n    threadMessagesLoading,\n    connections,'
);

fs.writeFileSync('dashboard/src/v2/ChatPage.tsx', chatPage);
