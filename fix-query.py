import re

with open('src/repositories/execution/project-execution-snapshot-query.ts', 'r') as f:
    content = f.read()

content = content.replace(
    'rawUsageJson: (row as any).raw_usage_json ? parsePayloadJson((row as any).raw_usage_json) : undefined,',
    'rawUsageJson: (row as any).raw_usage_json ? parsePayloadJson((row as any).raw_usage_json) : null,'
)

with open('src/repositories/execution/project-execution-snapshot-query.ts', 'w') as f:
    f.write(content)
