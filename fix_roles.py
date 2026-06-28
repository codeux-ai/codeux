import re

with open('dashboard/src/v2/ChatPage.tsx', 'r') as f:
    content = f.read()

# For Threads view:
# Wrap the log with a tabpanel
# We'll replace the chat-panel div with a tabpanel div, and put the log inside it.
threads_panel_old = '<div id="chat-panel" role="log" aria-labelledby="tab-threads" aria-label="Message history" ref={messagesRef} className="flex-1 min-h-0 space-y-6 overflow-y-auto px-6 py-6">'
threads_panel_new = """<div id="chat-panel" role="tabpanel" aria-labelledby="tab-threads" className="flex-1 min-h-0 flex flex-col">
          <div role="log" aria-label="Message history" aria-live={messages.length > 0 && !threadsLoading && !threadMessagesLoading ? "polite" : "off"} aria-atomic="false" aria-relevant="additions" ref={messagesRef} className="flex-1 min-h-0 space-y-6 overflow-y-auto px-6 py-6">"""

content = content.replace(threads_panel_old, threads_panel_new)

# For Invocations view:
invocations_panel_old = '<div id="chat-panel" role="log" aria-labelledby={chatMode === "threads" ? "tab-threads" : "tab-invocations"} aria-label="Message history" ref={messagesRef} className="flex-1 min-h-0 space-y-6 overflow-y-auto px-6 py-6">'
invocations_panel_new = """<div id="chat-panel" role="tabpanel" aria-labelledby="tab-invocations" className="flex-1 min-h-0 flex flex-col">
        <div role="log" aria-label="Message history" aria-live={invocationMessages.length > 0 && !invocationsLoading && !invocationMessagesLoading ? "polite" : "off"} aria-atomic="false" aria-relevant="additions" ref={messagesRef} className="flex-1 min-h-0 space-y-6 overflow-y-auto px-6 py-6">"""

content = content.replace(invocations_panel_old, invocations_panel_new)

# Need to close the new tabpanel divs
# For Threads, we need to add </div> before the composer section
# Look for <div className="shrink-0 border-t border-black/[0.05] p-5 dark:border-white/[0.05]">
threads_close_old = '<div className="shrink-0 border-t border-black/[0.05] p-5 dark:border-white/[0.05]">'
threads_close_new = '</div>\n          <div className="shrink-0 border-t border-black/[0.05] p-5 dark:border-white/[0.05]">'
content = content.replace(threads_close_old, threads_close_new, 1)

# For Invocations, we need to add </div> at the end of the renderDetail return for invocations
invocations_close_old = """          )}
        </div>
      );
    }
  };"""
invocations_close_new = """          )}
        </div>
        </div>
      );
    }
  };"""
content = content.replace(invocations_close_old, invocations_close_new)

with open('dashboard/src/v2/ChatPage.tsx', 'w') as f:
    f.write(content)
