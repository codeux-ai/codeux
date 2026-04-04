import re

with open('dashboard/src/v2/AgentsPage.tsx', 'r') as f:
    content = f.read()

# Make sure it stacks below lg
content = content.replace(
    'className="flex flex-col gap-8 lg:flex-row lg:items-start"',
    'className="flex flex-col gap-8 lg:flex-row lg:items-start"'
)

with open('dashboard/src/v2/AgentsPage.tsx', 'w') as f:
    f.write(content)
