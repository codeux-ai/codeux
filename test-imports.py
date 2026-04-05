import re

with open('src/repositories/execution-repository.ts', 'r') as f:
    content = f.read()

match = re.search(r'import \{[\s\S]*?listActiveAttentionRowsForSprintRuns[\s\S]*?\} from "\./execution/execution-human-intervention-query\.js";', content)
if not match:
    print("NO IMPORT FOUND")
    content = content.replace(
        'import { buildHumanInterventionSummaryBySprintRun } from "./execution/execution-human-intervention-query.js";',
        'import { buildHumanInterventionSummaryBySprintRun, listActiveAttentionRowsForSprintRuns } from "./execution/execution-human-intervention-query.js";'
    )
    with open('src/repositories/execution-repository.ts', 'w') as f:
        f.write(content)
else:
    print("IMPORT FOUND")
