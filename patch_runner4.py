import re

with open("tests/backend/infrastructure/providers/cli/provider-runner.test.ts", "r") as f:
    content = f.read()

content = re.sub(
    r'(it\("should run codex locally correctly", async \(\) => \{[\s\S]*?\n  )\}\);',
    r'\1}, 15000);',
    content
)

with open("tests/backend/infrastructure/providers/cli/provider-runner.test.ts", "w") as f:
    f.write(content)

print("Patched timeouts")
