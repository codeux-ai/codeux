import re

# Patch ChatMessageBubble.tsx
with open('dashboard/src/v2/components/chat/ChatMessageBubble.tsx', 'r') as f:
    content = f.read()

# Make the status accessible as sr-only text
# From {senderName} at {createdAtLabel}. Status: {displayDeliveryStatus}.
sr_only_text = """    <div ref={bubbleRef} className={`flex w-full ${fromDashboard ? "justify-end" : "justify-start"} ${reducedMotion ? "" : "opacity-0"}`}>
      <span className="sr-only">
        From {senderName} at {createdAtLabel}. Status: {displayDeliveryStatus}.
      </span>"""

content = content.replace('    <div ref={bubbleRef} className={`flex w-full ${fromDashboard ? "justify-end" : "justify-start"} ${reducedMotion ? "" : "opacity-0"}`}>', sr_only_text)

with open('dashboard/src/v2/components/chat/ChatMessageBubble.tsx', 'w') as f:
    f.write(content)


# Patch InvocationMessageBubble.tsx
with open('dashboard/src/v2/components/chat/InvocationMessageBubble.tsx', 'r') as f:
    content = f.read()

sr_only_text2 = """  return (
    <div className={`flex ${fromUser || fromTool ? "justify-end" : "justify-start"}`}>
      <span className="sr-only">
        From {senderName} at {createdAtLabel}. {displayStatus ? `Status: ${displayStatus}.` : ""} {errorLabel ? `Error: ${errorLabel}.` : ""}
      </span>"""

content = content.replace('  return (\n    <div className={`flex ${fromUser || fromTool ? "justify-end" : "justify-start"}`}>', sr_only_text2)

with open('dashboard/src/v2/components/chat/InvocationMessageBubble.tsx', 'w') as f:
    f.write(content)
