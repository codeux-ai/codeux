const fs = require('fs');

let code = fs.readFileSync('tests/backend/app/live/project-live-observability.test.ts', 'utf8');

code = code.replace(
  /payloadSizeBytes: expect.any\(Number\)/g,
  `executionItemCount: expect.any(Number), statusSubtaskCount: expect.any(Number), hasGitStatus: expect.any(Boolean)`
);
code = code.replace(
  /it\("emits project_live_snapshot_assembled info log with payload size", async \(\) => {/g,
  `it("emits project_live_snapshot_assembled info log with execution item count", async () => {`
);

fs.writeFileSync('tests/backend/app/live/project-live-observability.test.ts', code);
