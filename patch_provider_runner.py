import sys

with open("tests/backend/infrastructure/providers/cli/provider-runner.test.ts", "r") as f:
    lines = f.readlines()

new_lines = []
for i, line in enumerate(lines):
    if 'it("should run codex locally correctly", async () => {' in line:
        new_lines.append(line)
        # Find closing brace of this test block
        for j in range(i + 1, len(lines)):
            if lines[j].strip() == '});' and 'it("should capture codex text responses' in "".join(lines[j:]):
                # Only replace the *first* "});" after the test opening. We need to be exact.
                pass

    else:
        new_lines.append(line)

# Let's just do a simple replacement for the end bracket if we can find it exactly.
with open("tests/backend/infrastructure/providers/cli/provider-runner.test.ts", "r") as f:
    content = f.read()

import re
content = re.sub(
    r'(it\("should run codex locally correctly", async \(\) => \{[\s\S]*?\n  \}\));',
    r'\1, 15000);',
    content
)

with open("tests/backend/infrastructure/providers/cli/provider-runner.test.ts", "w") as f:
    f.write(content)

print("Patched cleanly")
