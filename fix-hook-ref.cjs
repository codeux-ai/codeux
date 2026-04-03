const fs = require('fs');
let hook = fs.readFileSync('dashboard/src/v2/hooks/use-chat-page-data.ts', 'utf8');

// Fix:
// options?.messagesRef?.current.scrollTop = ...  ->  if (options?.messagesRef?.current) { options.messagesRef.current.scrollTop = ... }
hook = hook.replace(
  'options?.messagesRef?.current.scrollTop = options?.messagesRef?.current.scrollHeight;',
  'if (options?.messagesRef?.current) {\n      options.messagesRef.current.scrollTop = options.messagesRef.current.scrollHeight;\n    }'
);

hook = hook.replace(
  'options?.composerRef?.current.style.height = "auto";',
  'if (options?.composerRef?.current) {\n        options.composerRef.current.style.height = "auto";\n      }'
);

fs.writeFileSync('dashboard/src/v2/hooks/use-chat-page-data.ts', hook);
