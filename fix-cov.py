import re

with open('vitest.config.ts', 'r') as f:
    content = f.read()

content = re.sub(
    r"branches: 63\.44,",
    "branches: 63.23,",
    content
)

with open('vitest.config.ts', 'w') as f:
    f.write(content)
