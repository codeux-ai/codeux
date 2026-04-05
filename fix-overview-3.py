import re

with open('src/repositories/execution-repository.ts', 'r') as f:
    content = f.read()

replacement = """    const eventAwareHumanInterventionBySprintRunId = buildHumanInterventionSummaryBySprintRun(
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
    };"""

content = re.sub(
    r'    const eventAwareHumanInterventionBySprintRunId = this\.buildHumanInterventionSummaryBySprintRun\([\s\S]*?      updatedAt: new Date\(\)\.toISOString\(\),\n    \};',
    replacement,
    content
)

content = re.sub(
    r'    const activeAttentionItems = this\.listActiveAttentionRowsForSprintRuns\(telemetrySprintRunIds\);',
    r'    const activeAttentionItems = listActiveAttentionRowsForSprintRuns(this.storage, telemetrySprintRunIds);',
    content
)

with open('src/repositories/execution-repository.ts', 'w') as f:
    f.write(content)
