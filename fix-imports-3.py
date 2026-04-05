import re

with open('src/repositories/execution-repository.ts', 'r') as f:
    content = f.read()

imports = """
import { getWallTimeTotalsByTaskIdsForRange, getWallTimeTotalsBySprintRunIdsForRange } from "./execution/execution-wall-time-query.js";
import { queryProjectExecutionSnapshot, mapProviderInvocationUsageRow, mapExecutionRuntimeEventSummaryRow } from "./execution/project-execution-snapshot-query.js";
import { buildHumanInterventionSummaryBySprintRun, listActiveAttentionRowsForSprintRuns } from "./execution/execution-human-intervention-query.js";
import { getUsageTotalsBySprintRunIds, getUsageTotalsByTaskIds, mergeUsageTotals, groupUsageBy } from "./execution/execution-usage-query.js";
import { ProviderInvocationUsageRow } from "./execution/execution-repository-types.js";
"""

content = content.replace('import { queryExecutionSprintRuns } from "./execution/execution-sprint-runs-query.js";', imports + '\nimport { queryExecutionSprintRuns } from "./execution/execution-sprint-runs-query.js";')

with open('src/repositories/execution-repository.ts', 'w') as f:
    f.write(content)
