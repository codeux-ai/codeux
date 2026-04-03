const fs = require('fs');

let chatPage = fs.readFileSync('dashboard/src/v2/ChatPage.tsx', 'utf8');

// 1. Remove helper functions that are now in the hook
chatPage = chatPage.replace(/const isWorkingMessage[\s\S]*?const toAgentConnection[\s\S]*?\}\);/m, '');

// 2. Import the hook
chatPage = chatPage.replace(
  'import { ChatMessageBubble } from "./components/chat/ChatMessageBubble.js";',
  'import { ChatMessageBubble } from "./components/chat/ChatMessageBubble.js";\nimport { useChatPageData } from "./hooks/use-chat-page-data.js";'
);

// 3. Replace the hook logic
const hookStart = '  const messagesRef = useRef<HTMLDivElement>(null);\n  const composerRef = useRef<HTMLTextAreaElement>(null);';
const hookEnd = '    } finally {\n      setDeletingThreadId((current) => current === threadId ? null : current);\n    }\n  }, [activateThread, refreshThreads, selectedProject, selectedThreadId, setThreadsSnapshot]);';

const hookRegex = new RegExp('(  const selectedThreadIdRef = useRef<string \\| null>\\(null\\);[\\s\\S]*?  const handleDeleteThread = useCallback\\(async \\(threadId: string\\): Promise<void> => \\{[\\s\\S]*?\\}, \\[activateThread, refreshThreads, selectedProject, selectedThreadId, setThreadsSnapshot\\]\\);)', 'm');

const match = hookRegex.exec(chatPage);
if (match) {
  chatPage = chatPage.replace(match[0], `  const {
    chatMode,
    setChatMode,
    threads,
    invocations,
    selectedThreadId,
    selectedInvocationId,
    messages,
    invocationMessages,
    input,
    setInput,
    manualRefreshing,
    deletingThreadId,
    sending,
    assigningRoute,
    compacting,
    error,
    selectedThread,
    selectedInvocation,
    activeConnection,
    pendingDashboardMessages,
    hasWorkingReply,
    threadsLoading,
    threadMessagesLoading,
    invocationsLoading,
    invocationMessagesLoading,
    refreshThreads,
    activateThread,
    activateInvocation,
    handleAssignRoute,
    handleCompactThread,
    handleSend,
    handleDeleteThread,
    createThreadForCompose,
    workerOptions,
    selectedProject,
  } = useChatPageData();

  useEffect(() => {
    if (!messagesRef.current) return;
    messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages]);`);
} else {
  console.log("Could not match the hook code in ChatPage.tsx");
}

// 4. Remove unused imports
const unusedImports = [
  'import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";',
  'import { useMessageCache } from "./hooks/useMessageCache.js";',
  'import { useProjectData } from "./context/project-data.js";',
  'import {\n  createConversationThread,\n  deleteConversationThread,\n  fetchConversationMessages,\n  fetchConversationThreads,\n  fetchProjectConnections,\n  postConversationMessage,\n  updateConversationThread,\n  updateThreadRoute,\n  compactThreadSession,\n} from "./lib/connection-api.js";',
  'import {\n  isDetailLoading,\n  isListLoading,\n  resolveSelectedItemId,\n} from "./lib/chat-page-state-utils.js";',
  'import { upsertChatThread } from "./lib/chat-thread-utils.js";',
  'import { fetchInvocationMessages, fetchProjectInvocations } from "./lib/invocation-api.js";',
  'import { subscribeToDashboardRealtime } from "../lib/realtime/dashboard-realtime-client.js";',
  'import { useExecutions } from "../hooks/useExecutions.js";',
  'import { getProjectWorkerOptions, type WorkerRoutingPreference } from "./lib/project-worker-options.js";',
  'import { toChatTimestampMs } from "./lib/chat-time.js";',
  'import { buildThreadIndex, buildInvocationIndex, buildConnectionIndex } from "./lib/chat-entity-index.js";',
  'import { useProjectEffectiveSettings } from "./hooks/use-project-effective-settings.js";',
];

for (const imp of unusedImports) {
  chatPage = chatPage.replace(imp, '');
}

chatPage = chatPage.replace('import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";', 'import { useEffect, useRef } from "preact/hooks";');

// Fix the imports properly
chatPage = chatPage.replace(
  'import type { FunctionComponent } from "preact";\n\nimport gsap from "gsap";',
  'import type { FunctionComponent } from "preact";\nimport { useEffect, useRef } from "preact/hooks";\nimport gsap from "gsap";'
);

fs.writeFileSync('dashboard/src/v2/ChatPage.tsx', chatPage);
