import re

with open('src/repositories/execution-repository.ts', 'r') as f:
    content = f.read()

content = content.replace(
    'import { queryProjectExecutionSnapshot, mapProviderInvocationUsageRow, mapExecutionRuntimeEventSummaryRow } from "./execution/project-execution-snapshot-query.js";',
    'import { queryProjectExecutionSnapshot, mapProviderInvocationUsageRow, mapExecutionRuntimeEventSummaryRow } from "./execution/project-execution-snapshot-query.js";\nimport { buildHumanInterventionSummaryBySprintRun, listActiveAttentionRowsForSprintRuns } from "./execution/execution-human-intervention-query.js";'
)

with open('src/repositories/execution-repository.ts', 'w') as f:
    f.write(content)
