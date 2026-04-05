import re

with open('src/repositories/execution-repository.ts', 'r') as f:
    content = f.read()

# Fix the bug with buildHumanInterventionSummaryBySprintRun in getOverviewTelemetrySnapshot

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
    r'    const eventAwareHumanInterventionBySprintRunId = buildHumanInterventionSummaryBySprintRun\([\s\S]*?      updatedAt: new Date\(\)\.toISOString\(\),\n    \};',
    replacement,
    content
)

with open('src/repositories/execution-repository.ts', 'w') as f:
    f.write(content)

with open('tests/backend/repositories/execution-repository.test.ts', 'r') as f:
    test_content = f.read()

# Fix broken test calling private method
test_content = re.sub(
    r'  it\("handles null summary from buildHumanInterventionSummaryFromAttentionRows"[\s\S]*?  \}\);\n',
    '',
    test_content
)

with open('tests/backend/repositories/execution-repository.test.ts', 'w') as f:
    f.write(test_content)
