with open('dashboard/src/v2/ChatPage.tsx', 'r') as f:
    content = f.read()

# Instead of wrapping with a tabpanel, let's just make the existing `chat-panel` the `tabpanel` and its children can include the log.
# Currently: <div id="chat-panel" role="log" ...>
# Let's change it to role="tabpanel" and add a new div inside it for role="log".

def replace_panel(content, old_str, new_str):
    return content.replace(old_str, new_str)

old_threads_panel = '<div id="chat-panel" role="log" aria-label="Message history" ref={messagesRef} className="flex-1 min-h-0 space-y-6 overflow-y-auto px-6 py-6">'
new_threads_panel = """<div id="chat-panel" role="tabpanel" aria-labelledby="tab-threads" className="flex-1 min-h-0 flex flex-col overflow-y-auto">
          <div role="log" aria-label="Message history" aria-live={messages.length > 0 && !threadsLoading && !threadMessagesLoading ? "polite" : "off"} aria-atomic="false" aria-relevant="additions" ref={messagesRef} className="flex-1 min-h-0 space-y-6 px-6 py-6">"""

content = replace_panel(content, old_threads_panel, new_threads_panel)

# find the exact closing tag for the threads panel. The threads panel is followed by:
#           </div>
#
#           <div className="shrink-0 border-t border-black/[0.05] p-5 dark:border-white/[0.05]">
old_threads_close = """          </div>

          <div className="shrink-0 border-t border-black/[0.05] p-5 dark:border-white/[0.05]">"""
new_threads_close = """          </div>
          </div>

          <div className="shrink-0 border-t border-black/[0.05] p-5 dark:border-white/[0.05]">"""
content = replace_panel(content, old_threads_close, new_threads_close)


# Now invocations
old_invocs_panel = '<div id="chat-panel" role="log" aria-labelledby={chatMode === "threads" ? "tab-threads" : "tab-invocations"} aria-label="Message history" ref={messagesRef} className="flex-1 min-h-0 space-y-6 overflow-y-auto px-6 py-6">'
new_invocs_panel = """<div id="chat-panel" role="tabpanel" aria-labelledby="tab-invocations" className="flex-1 min-h-0 flex flex-col overflow-y-auto">
        <div role="log" aria-label="Message history" aria-live={invocationMessages.length > 0 && !invocationsLoading && !invocationMessagesLoading ? "polite" : "off"} aria-atomic="false" aria-relevant="additions" ref={messagesRef} className="flex-1 min-h-0 space-y-6 px-6 py-6">"""
content = replace_panel(content, old_invocs_panel, new_invocs_panel)

old_invocs_close = """        </div>

        <div className="shrink-0 border-t border-black/[0.05] p-5 dark:border-white/[0.05]">"""
new_invocs_close = """        </div>
        </div>

        <div className="shrink-0 border-t border-black/[0.05] p-5 dark:border-white/[0.05]">"""
content = replace_panel(content, old_invocs_close, new_invocs_close)

with open('dashboard/src/v2/ChatPage.tsx', 'w') as f:
    f.write(content)
