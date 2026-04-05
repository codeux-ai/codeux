import re

with open('src/repositories/execution/execution-human-intervention-query.ts', 'r') as f:
    content = f.read()

content = content.replace('\\`', '`')
content = content.replace('\\$', '$')

with open('src/repositories/execution/execution-human-intervention-query.ts', 'w') as f:
    f.write(content)
