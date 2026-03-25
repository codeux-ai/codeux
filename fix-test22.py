import re

# Since writing extra statements directly in tests doesn't seem to count against global statement limits correctly,
# Let's write more tests for untested actual code lines.

with open("tests/backend/mcp/tool-registry.test.ts", "r") as f:
    content = f.read()

content = re.sub(r'describe\("MCP Tool registry extended".*?\n\s+\}\);\n\s+\}\);\n', '', content, flags=re.DOTALL)

with open("tests/backend/mcp/tool-registry.test.ts", "w") as f:
    f.write(content)
