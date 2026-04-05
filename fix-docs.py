import re

with open('docs/architecture/execution-dashboard-projection.md', 'r') as f:
    content = f.read()

replacement = """## Repository Source

Projection is built in:

- `src/repositories/execution-repository.ts` (public API boundary and snapshot orchestrator)
- `src/repositories/execution/project-execution-snapshot-query.ts` (dashboard snapshot coordination and usage/wall-time mappings)
- `src/repositories/execution/execution-sprint-runs-query.ts` (sprint runs slice query)
- `src/repositories/execution/execution-task-dispatches-query.ts` (dispatches slice query)
- `src/repositories/execution/execution-runtime-events-query.ts` (events slice query)
- `src/repositories/execution/execution-usage-query.ts` (provider usage mapping and rollups)
- `src/repositories/execution/execution-wall-time-query.ts` (wall-time duration projection)
- `src/repositories/execution/execution-human-intervention-query.ts` (operator attention formatting)

It joins:"""

content = content.replace(
"""## Repository Source

Projection is built in:

- `src/repositories/execution-repository.ts` (public API boundary and snapshot orchestrator)
- `src/repositories/execution/execution-sprint-runs-query.ts` (sprint runs slice query)
- `src/repositories/execution/execution-task-dispatches-query.ts` (dispatches slice query)
- `src/repositories/execution/execution-runtime-events-query.ts` (events slice query)

It joins:""", replacement)

with open('docs/architecture/execution-dashboard-projection.md', 'w') as f:
    f.write(content)
