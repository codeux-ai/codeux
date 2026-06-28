import re

with open('dashboard/src/v2/ChatPage.tsx', 'r') as f:
    content = f.read()

# Update chat-panel in threads view
panel_threads_orig = '<div id="chat-panel" role="log" aria-label="Message history" ref={messagesRef} className="flex-1 min-h-0 space-y-6 overflow-y-auto px-6 py-6">'
panel_threads_new = '<div id="chat-panel" role="log" aria-labelledby="tab-threads" aria-label="Message history" ref={messagesRef} className="flex-1 min-h-0 space-y-6 overflow-y-auto px-6 py-6">'

content = content.replace(panel_threads_orig, panel_threads_new, 1)

# Update chat-panel in invocations view
# Note: we should replace it generally
panel_orig = '<div id="chat-panel" role="log" aria-label="Message history" ref={messagesRef} className="flex-1 min-h-0 space-y-6 overflow-y-auto px-6 py-6">'
panel_new = '<div id="chat-panel" role="log" aria-labelledby={chatMode === "threads" ? "tab-threads" : "tab-invocations"} aria-label="Message history" ref={messagesRef} className="flex-1 min-h-0 space-y-6 overflow-y-auto px-6 py-6">'

content = content.replace(panel_orig, panel_new)

with open('dashboard/src/v2/ChatPage.tsx', 'w') as f:
    f.write(content)
