import re

with open("tests/backend/services/quicksprint-service.test.ts", "r") as f:
    content = f.read()

content = content.replace('  });\n});\n', '  });\n')

with open("tests/backend/services/quicksprint-service.test.ts", "w") as f:
    f.write(content)
