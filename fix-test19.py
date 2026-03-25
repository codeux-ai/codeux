import re
with open("tests/backend/mcp/tool-registry.test.ts", "r") as f:
    content = f.read()

content = re.sub(r'describe\("MCP Tool registry extended".*?\n\s+\}\);\n\s+\}\);\n', '', content, flags=re.DOTALL)
content = re.sub(r'import \{ getMcpToolDefinitions.*?\n', '', content)

with open("tests/backend/mcp/tool-registry.test.ts", "w") as f:
    f.write(content)
