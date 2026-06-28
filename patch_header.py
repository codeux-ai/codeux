with open('dashboard/src/v2/components/chat/ChatThreadHeader.tsx', 'r') as f:
    content = f.read()

content = content.replace(
    'Replay Required',
    '<span className="sr-only">Status: </span>Replay Required'
)
content = content.replace(
    'Active Session',
    '<span className="sr-only">Status: </span>Active Session'
)
content = content.replace(
    'New/Compacted',
    '<span className="sr-only">Status: </span>New/Compacted'
)

with open('dashboard/src/v2/components/chat/ChatThreadHeader.tsx', 'w') as f:
    f.write(content)
