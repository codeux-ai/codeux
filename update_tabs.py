import re

with open('dashboard/src/v2/components/chat/ChatPageShell.tsx', 'r') as f:
    content = f.read()

# Make tablist focusable/keyboard navigable by updating it
tablist_replacement = """
          <div role="tablist" aria-label="Chat Mode" className="flex items-center rounded-full border border-black/[0.06] bg-white/70 p-1 dark:border-white/[0.06] dark:bg-white/[0.03]"
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const newMode = chatMode === "threads" ? "invocations" : "threads";
                onSetChatMode(newMode);
                // Also focus the corresponding tab
                const targetId = newMode === "threads" ? "tab-threads" : "tab-invocations";
                document.getElementById(targetId)?.focus();
              }
            }}
          >
"""

content = content.replace('<div role="tablist" aria-label="Chat Mode" className="flex items-center rounded-full border border-black/[0.06] bg-white/70 p-1 dark:border-white/[0.06] dark:bg-white/[0.03]">', tablist_replacement)

# Update threads tab
thread_tab_orig = """            <button
              role="tab"
              aria-selected={chatMode === "threads"}
              aria-controls="chat-panel"
              type="button"
              onClick={() => onSetChatMode("threads")}"""

thread_tab_new = """            <button
              id="tab-threads"
              role="tab"
              aria-selected={chatMode === "threads"}
              aria-controls="chat-panel"
              tabIndex={chatMode === "threads" ? 0 : -1}
              type="button"
              onClick={() => onSetChatMode("threads")}"""

content = content.replace(thread_tab_orig, thread_tab_new)

# Update invocations tab
invocations_tab_orig = """            <button
              role="tab"
              aria-selected={chatMode === "invocations"}
              aria-controls="chat-panel"
              type="button"
              onClick={() => onSetChatMode("invocations")}"""

invocations_tab_new = """            <button
              id="tab-invocations"
              role="tab"
              aria-selected={chatMode === "invocations"}
              aria-controls="chat-panel"
              tabIndex={chatMode === "invocations" ? 0 : -1}
              type="button"
              onClick={() => onSetChatMode("invocations")}"""

content = content.replace(invocations_tab_orig, invocations_tab_new)

with open('dashboard/src/v2/components/chat/ChatPageShell.tsx', 'w') as f:
    f.write(content)
