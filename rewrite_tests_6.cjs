const fs = require('fs');
const path = require('path');
const targetFile = path.join(__dirname, 'tests/dashboard/v2/settings-page-data.test.tsx');
let code = fs.readFileSync(targetFile, 'utf8');

const mockRouting = {
  task_coding: { provider: null, allowedProviders: [], providers: {} },
  planning: { provider: null, allowedProviders: [], providers: {} },
  dashboard_reply: { provider: null, allowedProviders: [], providers: {} },
  clarification_reply: { provider: null, allowedProviders: [], providers: {} },
  ci_fix: { provider: null, allowedProviders: [], providers: {} },
  merge_conflict: { provider: null, allowedProviders: [], providers: {} }
};

code = code.replace(
  'invocationRouting: {}',
  `invocationRouting: ${JSON.stringify(mockRouting)}`
);
code = code.replace(
  'invocationRouting: {}',
  `invocationRouting: ${JSON.stringify(mockRouting)}`
);

fs.writeFileSync(targetFile, code, 'utf8');
