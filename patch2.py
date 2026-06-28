import re

with open('dashboard/src/v2/ChatPage.tsx', 'r') as f:
    content = f.read()

# Replace thread panel
threads_panel_old = '<div id="chat-panel" role="log" aria-label="Message history" ref={messagesRef} className="flex-1 min-h-0 space-y-6 overflow-y-auto px-6 py-6">'
threads_panel_new = """<div id="chat-panel" role="tabpanel" aria-labelledby="tab-threads" className="flex-1 min-h-0 flex flex-col">
          <div role="log" aria-label="Message history" aria-live={messages.length > 0 && !threadsLoading && !threadMessagesLoading ? "polite" : "off"} aria-atomic="false" aria-relevant="additions" ref={messagesRef} className="flex-1 min-h-0 space-y-6 overflow-y-auto px-6 py-6">"""
content = content.replace(threads_panel_old, threads_panel_new)

# Notice how the original block for threads ends:
#           </div>
#
#           <div className="shrink-0 border-t border-black/[0.05] p-5 dark:border-white/[0.05]">
# We need to add a closing </div> before this <div className="shrink-0 border-t...">.

content = content.replace(
    '          <div className="shrink-0 border-t border-black/[0.05] p-5 dark:border-white/[0.05]">',
    '          </div>\n          <div className="shrink-0 border-t border-black/[0.05] p-5 dark:border-white/[0.05]">',
    1
)

# Replace invocations panel
invocations_panel_old = '<div id="chat-panel" role="log" aria-labelledby={chatMode === "threads" ? "tab-threads" : "tab-invocations"} aria-label="Message history" ref={messagesRef} className="flex-1 min-h-0 space-y-6 overflow-y-auto px-6 py-6">'
# it might not have aria-labelledby if we restored
invocations_panel_old_orig = '<div id="chat-panel" role="log" aria-label="Message history" ref={messagesRef} className="flex-1 min-h-0 space-y-6 overflow-y-auto px-6 py-6">'
invocations_panel_new = """<div id="chat-panel" role="tabpanel" aria-labelledby="tab-invocations" className="flex-1 min-h-0 flex flex-col">
        <div role="log" aria-label="Message history" aria-live={invocationMessages.length > 0 && !invocationsLoading && !invocationMessagesLoading ? "polite" : "off"} aria-atomic="false" aria-relevant="additions" ref={messagesRef} className="flex-1 min-h-0 space-y-6 overflow-y-auto px-6 py-6">"""
content = content.replace(invocations_panel_old_orig, invocations_panel_new)

# Same for invocations close
content = content.replace(
    '        <div className="shrink-0 border-t border-black/[0.05] p-5 dark:border-white/[0.05]">',
    '        </div>\n        <div className="shrink-0 border-t border-black/[0.05] p-5 dark:border-white/[0.05]">',
    1
)

with open('dashboard/src/v2/ChatPage.tsx', 'w') as f:
    f.write(content)
