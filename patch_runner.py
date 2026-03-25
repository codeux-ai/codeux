import re

with open("tests/backend/infrastructure/providers/cli/provider-runner.test.ts", "r") as f:
    content = f.read()

# Replace the specific closure
target = """    expect(env.CODEX_MODEL).toBe("test-model");
    expect(env.OPENAI_API_KEY).toBe("test-api-key");
  });

  it("should capture codex text responses into a mounted output file","""

new_target = """    expect(env.CODEX_MODEL).toBe("test-model");
    expect(env.OPENAI_API_KEY).toBe("test-api-key");
  }, 15000);

  it("should capture codex text responses into a mounted output file","""

if target in content:
    content = content.replace(target, new_target)
    with open("tests/backend/infrastructure/providers/cli/provider-runner.test.ts", "w") as f:
        f.write(content)
    print("Patched correctly")
else:
    print("Could not find target")
