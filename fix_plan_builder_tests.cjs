const fs = require('fs');
const testPath = 'tests/backend/domain/sprint/orchestrator/attention-plan-builder.test.ts';
let testContent = fs.readFileSync(testPath, 'utf8');

testContent = testContent.replace(
  'expect(t1MergeReplace?.typesToResolve).toEqual(["merge_conflict"]);',
  'expect(t1MergeReplace?.typesToResolve).toEqual(["merge_conflict"]);'
); // placeholder to just re-read the code

fs.writeFileSync(testPath, testContent, 'utf8');
