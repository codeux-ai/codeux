import re

with open('src/repositories/execution-repository.ts', 'r') as f:
    content = f.read()

# Replace getProjectExecutionSnapshot
get_snapshot_re = r'  getProjectExecutionSnapshot\(projectId: string\): ExecutionDashboardSnapshot \{[\s\S]*?updatedAt: new Date\(\)\.toISOString\(\),\n    \};\n  \}'
new_get_snapshot = """  getProjectExecutionSnapshot(projectId: string): ExecutionDashboardSnapshot {
    this.requireProject(projectId);
    return queryProjectExecutionSnapshot(this.db, this.storage, projectId);
  }"""
content = re.sub(get_snapshot_re, new_get_snapshot, content)

# Remove the inline interface
content = re.sub(r'interface ProviderInvocationUsageRow \{[\s\S]*?  usage_source: string;\n\}', '', content)

content = content.replace('const wallTimeByTaskId = this.getWallTimeTotalsByTaskIdsForRange(projectId, rangeStartIso, rangeEndIso, nowIso);', 'const wallTimeByTaskId = getWallTimeTotalsByTaskIdsForRange(this.db, projectId, rangeStartIso, rangeEndIso, nowIso);')
content = content.replace('const wallTimeBySprintRunId = this.getWallTimeTotalsBySprintRunIdsForRange(projectId, rangeStartIso, rangeEndIso, nowIso);', 'const wallTimeBySprintRunId = getWallTimeTotalsBySprintRunIdsForRange(this.db, projectId, rangeStartIso, rangeEndIso, nowIso);')
content = content.replace('const mappedInvocations = invocations.map(row => this.mapProviderInvocationUsageRow(row));', 'const mappedInvocations = invocations.map(row => mapProviderInvocationUsageRow(row));')
content = content.replace('this.mergeUsageTotals(', 'mergeUsageTotals(')
content = content.replace('return row ? this.mapProviderInvocationUsageRow(row) : null;', 'return row ? mapProviderInvocationUsageRow(row) : null;')

content = content.replace('const activeAttentionItems = this.listActiveAttentionRowsForSprintRuns(telemetrySprintRunIds);', 'const activeAttentionItems = listActiveAttentionRowsForSprintRuns(this.storage, telemetrySprintRunIds);')

# Replace the eventAwareHumanInterventionBySprintRunId calculation in getOverviewTelemetrySnapshot
replacement = """
    const eventAwareHumanInterventionBySprintRunId = buildHumanInterventionSummaryBySprintRun(
      [...activeProjects, ...pausedProjects].map((row) => ({
        id: row.sprint_run_id,
        sprint_id: row.sprint_id,
        status: row.sprint_run_status,
      })),
      activeAttentionItems,
      recentEvents,
    );

    return {
      activeProjects: activeProjects.map((row) => this.mapOverviewTelemetryProjectSummaryRow(
        row,
        eventAwareHumanInterventionBySprintRunId.get(row.sprint_run_id) || null,
      )),
      attentionProjects: pausedProjects
        .filter((row) => Boolean(eventAwareHumanInterventionBySprintRunId.get(row.sprint_run_id)))
        .map((row) => this.mapOverviewTelemetryProjectSummaryRow(
          row,
          eventAwareHumanInterventionBySprintRunId.get(row.sprint_run_id) || null,
        )),
      recentEvents: recentEvents.map((row) => mapExecutionRuntimeEventSummaryRow(row)),
      updatedAt: new Date().toISOString(),
    };
"""

content = re.sub(
    r'    const eventAwareHumanInterventionBySprintRunId = this\.buildHumanInterventionSummaryBySprintRun\([\s\S]*?      updatedAt: new Date\(\)\.toISOString\(\),\n    \};',
    replacement,
    content
)


# Methods to remove
methods_to_remove = [
  'mapExecutionSprintRunSummaryRow',
  'mapExecutionTaskDispatchSummaryRow',
  'mapExecutionRuntimeEventSummaryRow',
  'listActiveAttentionRowsForProject',
  'listActiveAttentionRowsForSprintRuns',
  'buildHumanInterventionSummaryBySprintRun',
  'buildHumanInterventionSummaryFromAttentionRows',
  'buildHumanInterventionSummaryFromEvents',
  'createHumanInterventionSummary',
  'compareAttentionPriority',
  'getAttentionTypePriority',
  'isOperatorInterventionAttentionRow',
  'withWallTime',
  'mergeUsageTotals',
  'getUsageTotalsByTaskIds',
  'getUsageTotalsBySprintRunIds',
  'groupUsageBy',
  'getWallTimeTotalsByTaskIds',
  'getWallTimeTotalsBySprintRunIds',
  'getWallTimeTotalsByTaskIdsForRange',
  'getWallTimeTotalsBySprintRunIdsForRange',
  'mapProviderInvocationUsageRow'
]

for method in methods_to_remove:
  regex = r'\s*private\s*' + method + r'\s*\([\s\S]*?\n  \}(?=\n)'
  content = re.sub(regex, '', content)

with open('src/repositories/execution-repository.ts', 'w') as f:
    f.write(content)
