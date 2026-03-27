const fs = require('fs');
let content = fs.readFileSync('dashboard/src/v2/ChatPage.tsx', 'utf8');

// Bubble 1
const invocationSearch = `const InvocationMessageBubble: FunctionComponent<{ message: ExecutionInvocationMessageRecord }> = ({ message }) => {
  const fromSystem = message.role === "system";
  const fromUser = message.role === "user";
  const fromTool = message.role === "tool";
  const fromAssistant = message.role === "assistant";

  return (
    <div className={\`flex \${fromUser || fromTool ? "justify-end" : "justify-start"}\`}>
      <div className={\`flex max-w-[760px] items-start gap-3 \${fromUser || fromTool ? "flex-row-reverse" : "flex-row"}\`}>
        <div className={\`mt-1 flex h-9 w-9 items-center justify-center rounded-[0.9rem] \${
          fromUser || fromTool
            ? "border border-black/[0.06] bg-white text-slate-500 dark:border-white/[0.06] dark:bg-void-700 dark:text-slate-300"
            : "border border-signal-500/20 bg-signal-500/10 text-signal-500"
        }\`}>
          {fromUser || fromTool ? <UserCircle2 className="h-4 w-4" strokeWidth={1.6} /> : <Sparkles className="h-4 w-4" strokeWidth={1.6} />}
        </div>
        <div className="space-y-2">
          <div className={\`rounded-[1.5rem] px-5 py-4 shadow-[0_2px_16px_rgba(0,0,0,0.04)] \${
            fromUser || fromTool
              ? "rounded-tr-sm border border-signal-500/20 bg-signal-500/10 text-slate-900 dark:text-white"
              : "rounded-tl-sm border border-black/[0.06] bg-white/75 text-slate-700 dark:border-white/[0.06] dark:bg-void-800/70 dark:text-slate-200"
          }\`}>
            <div
              className="prose prose-sm max-w-none text-[14px] leading-7 text-inherit prose-headings:text-inherit prose-p:text-inherit prose-strong:text-inherit prose-code:text-inherit"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(message.contentMarkdown || "*(No message content)*") }}
            />
            {message.toolCallsJson && (
              <div className="mt-4 rounded border border-black/[0.06] bg-black/[0.03] p-3 text-xs dark:border-white/[0.06] dark:bg-white/[0.03]">
                <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-slate-600 dark:text-slate-400">
                  {JSON.stringify(message.toolCallsJson, null, 2)}
                </pre>
              </div>
            )}
          </div>
          <div className={\`px-1 text-[10px] font-mono text-slate-400 flex items-center gap-2 \${fromUser || fromTool ? "justify-end" : "justify-start"}\`}>
            <span>{formatTime(message.createdAt)}</span>
            <span className="capitalize">{message.role}</span>
          </div>
        </div>
      </div>
    </div>
  );
};`;

const invocationReplace = `const InvocationMessageBubble: FunctionComponent<{ message: ExecutionInvocationMessageRecord }> = ({ message }) => {
  const fromUser = message.role === "user";
  const fromTool = message.role === "tool";
  const isUserSide = fromUser || fromTool;

  return (
    <div className={\`flex \${isUserSide ? "justify-end" : "justify-start"}\`}>
      <div className={\`flex max-w-[760px] items-start gap-3 \${isUserSide ? "flex-row-reverse" : "flex-row"}\`}>
        <ChatIdentityAvatar role={message.role} className="mt-1" />
        <div className="space-y-2">
          <ChatSurfaceCard isUser={isUserSide}>
            <div
              className="prose prose-sm max-w-none text-[14px] leading-7 text-inherit prose-headings:text-inherit prose-p:text-inherit prose-strong:text-inherit prose-code:text-inherit"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(message.contentMarkdown || "*(No message content)*") }}
            />
            {message.toolCallsJson && (
              <div className="mt-4 rounded border border-black/[0.06] bg-black/[0.03] p-3 text-xs dark:border-white/[0.06] dark:bg-white/[0.03]">
                <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-slate-600 dark:text-slate-400">
                  {JSON.stringify(message.toolCallsJson, null, 2)}
                </pre>
              </div>
            )}
          </ChatSurfaceCard>
          <div className={\`px-1 text-[10px] font-mono text-slate-400 flex items-center gap-2 \${isUserSide ? "justify-end" : "justify-start"}\`}>
            <span>{formatTime(message.createdAt)}</span>
            <span className="capitalize">{message.role}</span>
          </div>
        </div>
      </div>
    </div>
  );
};`;
content = content.replace(invocationSearch, invocationReplace);


const messageSearch = `const MessageBubble: FunctionComponent<{ message: ChatMessageRecord }> = ({ message }) => {
  const fromDashboard = message.direction === "dashboard_to_connection";
  return (
    <div className={\`flex \${fromDashboard ? "justify-end" : "justify-start"}\`}>
      <div className={\`flex max-w-[760px] items-start gap-3 \${fromDashboard ? "flex-row-reverse" : "flex-row"}\`}>
        <div className={\`mt-1 flex h-9 w-9 items-center justify-center rounded-[0.9rem] \${
          fromDashboard
            ? "border border-black/[0.06] bg-white text-slate-500 dark:border-white/[0.06] dark:bg-void-700 dark:text-slate-300"
            : "border border-signal-500/20 bg-signal-500/10 text-signal-500"
        }\`}>
          {fromDashboard ? <UserCircle2 className="h-4 w-4" strokeWidth={1.6} /> : <Sparkles className="h-4 w-4" strokeWidth={1.6} />}
        </div>
        <div className="space-y-2">
          <div className={\`rounded-[1.5rem] px-5 py-4 shadow-[0_2px_16px_rgba(0,0,0,0.04)] \${
            fromDashboard
              ? "rounded-tr-sm border border-signal-500/20 bg-signal-500/10 text-slate-900 dark:text-white"
              : "rounded-tl-sm border border-black/[0.06] bg-white/75 text-slate-700 dark:border-white/[0.06] dark:bg-void-800/70 dark:text-slate-200"
          }\`}>
            <div
              className="prose prose-sm max-w-none text-[14px] leading-7 text-inherit prose-headings:text-inherit prose-p:text-inherit prose-strong:text-inherit prose-code:text-inherit"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(message.bodyMarkdown) }}
            />
          </div>
          <div className="flex items-center gap-3 px-1 text-[10px] font-mono text-slate-400">
            <span>{formatTime(message.createdAt)}</span>
            <span>{message.deliveryStatus}</span>
          </div>
        </div>
      </div>
    </div>
  );
};`;
const messageReplace = `const MessageBubble: FunctionComponent<{ message: ChatMessageRecord }> = ({ message }) => {
  const fromDashboard = message.direction === "dashboard_to_connection";
  return (
    <div className={\`flex \${fromDashboard ? "justify-end" : "justify-start"}\`}>
      <div className={\`flex max-w-[760px] items-start gap-3 \${fromDashboard ? "flex-row-reverse" : "flex-row"}\`}>
        <ChatIdentityAvatar role={fromDashboard ? "dashboard_user" : "connection"} className="mt-1" />
        <div className="space-y-2">
          <ChatSurfaceCard isUser={fromDashboard}>
            <div
              className="prose prose-sm max-w-none text-[14px] leading-7 text-inherit prose-headings:text-inherit prose-p:text-inherit prose-strong:text-inherit prose-code:text-inherit"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(message.bodyMarkdown) }}
            />
          </ChatSurfaceCard>
          <div className="flex items-center gap-3 px-1 text-[10px] font-mono text-slate-400">
            <span>{formatTime(message.createdAt)}</span>
            <span>{message.deliveryStatus}</span>
          </div>
        </div>
      </div>
    </div>
  );
};`;
content = content.replace(messageSearch, messageReplace);

const workingSearch = `const WorkingBubble: FunctionComponent<{ displayName: string | null }> = ({ displayName }) => (
  <div className="flex justify-start">
    <div className="flex max-w-[760px] items-start gap-3">
      <div className="mt-1 flex h-9 w-9 items-center justify-center rounded-[0.9rem] border border-signal-500/20 bg-signal-500/10 text-signal-500">
        <Sparkles className="h-4 w-4" strokeWidth={1.6} />
      </div>
      <div className="space-y-2">
        <div className="rounded-[1.5rem] rounded-tl-sm border border-black/[0.06] bg-white/75 px-5 py-4 text-slate-700 shadow-[0_2px_16px_rgba(0,0,0,0.04)] dark:border-white/[0.06] dark:bg-void-800/70 dark:text-slate-200">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-slate-500 dark:text-slate-400">
              {displayName || "Listener"} is preparing a reply
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 animate-pulse rounded-full bg-signal-500" />
              <span className="h-2 w-2 animate-pulse rounded-full bg-signal-500 [animation-delay:120ms]" />
              <span className="h-2 w-2 animate-pulse rounded-full bg-signal-500 [animation-delay:240ms]" />
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
);`;
const workingReplace = `const WorkingBubble: FunctionComponent<{ displayName: string | null }> = ({ displayName }) => (
  <div className="flex justify-start">
    <div className="flex max-w-[760px] items-start gap-3">
      <ChatIdentityAvatar role="connection" className="mt-1" />
      <div className="space-y-2">
        <ChatSurfaceCard isUser={false}>
          <ChatActivityWidget status="waiting" displayName={displayName || "Listener"} />
        </ChatSurfaceCard>
      </div>
    </div>
  </div>
);`;
content = content.replace(workingSearch, workingReplace);

fs.writeFileSync('dashboard/src/v2/ChatPage.tsx', content);
