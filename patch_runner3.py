import re

with open("tests/backend/infrastructure/providers/cli/provider-runner.test.ts", "r") as f:
    content = f.read()

# Fix the syntax error, we replaced `});` with `}), 15000);` which is wrong, it should be `}, 15000);`
content = re.sub(
    r'(it\("should retry codex transient transport errors", async \(\) => \{[\s\S]*?\n  )\}\);',
    r'\1}, 15000);',
    content
)

with open("tests/backend/infrastructure/providers/cli/provider-runner.test.ts", "w") as f:
    f.write(content)

with open("tests/backend/infrastructure/providers/cli/provider-usage.test.ts", "r") as f:
    content2 = f.read()

content2 = re.sub(
    r'(it\("falls back to estimated Codex tokens when JSONL usage is unavailable", async \(\) => \{[\s\S]*?\n  )\}\);',
    r'\1}, 15000);',
    content2
)

with open("tests/backend/infrastructure/providers/cli/provider-usage.test.ts", "w") as f:
    f.write(content2)

print("Patched timeouts")
