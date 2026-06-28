import re

# Update ThreadListCard.tsx
with open('dashboard/src/v2/components/chat/ThreadListCard.tsx', 'r') as f:
    content = f.read()

# Update pending message counts. They are currently empty or visible badges, we should ensure they have sr-only text.
# The code has `<div className="flex items-center gap-1.5 min-w-0">`
# Let's check `statusTone(pendingCount)` and `STATUS_PILL`
# the pending indicator is rendered as:
#                     {thread.pendingMessageCount > 0 && (
#                       <span className={`shrink-0 flex items-center justify-center h-4 w-4 rounded-full bg-status-amber/20 text-[9px] font-bold text-status-amber`}>
#                         {thread.pendingMessageCount}
#                       </span>
#                     )}
content = content.replace(
    '{thread.pendingMessageCount}',
    '{thread.pendingMessageCount}<span className="sr-only"> pending messages</span>'
)

with open('dashboard/src/v2/components/chat/ThreadListCard.tsx', 'w') as f:
    f.write(content)

# Update InvocationListCard.tsx
with open('dashboard/src/v2/components/chat/InvocationListCard.tsx', 'r') as f:
    content = f.read()

# Make sure error status has accessible text
# Let's find `<span className="truncate font-medium">{formatErrorCategory(invocation.lastErrorCategory)}</span>`
content = content.replace(
    '<span className="truncate font-medium">{formatErrorCategory(invocation.lastErrorCategory)}</span>',
    '<span className="sr-only">Error: </span><span className="truncate font-medium">{formatErrorCategory(invocation.lastErrorCategory)}</span>'
)
with open('dashboard/src/v2/components/chat/InvocationListCard.tsx', 'w') as f:
    f.write(content)
