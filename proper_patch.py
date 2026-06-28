import re

with open('dashboard/src/v2/ChatPage.tsx', 'r') as f:
    content = f.read()

# 1. Thread tab panel
# old: <div id="chat-panel" role="log" aria-label="Message history" ref={messagesRef} className="flex-1 min-h-0 space-y-6 overflow-y-auto px-6 py-6">
old_threads_panel = '<div id="chat-panel" role="log" aria-label="Message history" ref={messagesRef} className="flex-1 min-h-0 space-y-6 overflow-y-auto px-6 py-6">'
new_threads_panel = """<div id="chat-panel" role="tabpanel" aria-labelledby="tab-threads" className="flex-1 min-h-0 flex flex-col">
          <div role="log" aria-label="Message history" aria-live={messages.length > 0 && !threadsLoading && !threadMessagesLoading ? "polite" : "off"} aria-atomic="false" aria-relevant="additions" ref={messagesRef} className="flex-1 min-h-0 space-y-6 overflow-y-auto px-6 py-6">"""
content = content.replace(old_threads_panel, new_threads_panel, 1)

# we need to close the `tabpanel` before the composer div.
old_composer_div = '<div className="shrink-0 border-t border-black/[0.05] p-5 dark:border-white/[0.05]">'
new_composer_div = '</div>\n          <div className="shrink-0 border-t border-black/[0.05] p-5 dark:border-white/[0.05]">'
content = content.replace(old_composer_div, new_composer_div, 1)

# 2. Invocations tab panel
# old: <div id="chat-panel" role="log" aria-labelledby={chatMode === "threads" ? "tab-threads" : "tab-invocations"} aria-label="Message history" ref={messagesRef} className="flex-1 min-h-0 space-y-6 overflow-y-auto px-6 py-6">
# but we restored, so it's probably:
old_invocations_panel = '<div id="chat-panel" role="log" aria-label="Message history" ref={messagesRef} className="flex-1 min-h-0 space-y-6 overflow-y-auto px-6 py-6">'
new_invocations_panel = """<div id="chat-panel" role="tabpanel" aria-labelledby="tab-invocations" className="flex-1 min-h-0 flex flex-col">
        <div role="log" aria-label="Message history" aria-live={invocationMessages.length > 0 && !invocationsLoading && !invocationMessagesLoading ? "polite" : "off"} aria-atomic="false" aria-relevant="additions" ref={messagesRef} className="flex-1 min-h-0 space-y-6 overflow-y-auto px-6 py-6">"""
content = content.replace(old_invocations_panel, new_invocations_panel, 1)

# we need to close the `tabpanel` for invocations.
# find the read-only box div:
old_readonly_div = '<div className="shrink-0 border-t border-black/[0.05] p-5 dark:border-white/[0.05]">'
new_readonly_div = '</div>\n        <div className="shrink-0 border-t border-black/[0.05] p-5 dark:border-white/[0.05]">'
content = content.replace(old_readonly_div, new_readonly_div, 1)

with open('dashboard/src/v2/ChatPage.tsx', 'w') as f:
    f.write(content)
