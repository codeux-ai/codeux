const fs = require('fs');
const path = require('path');
const targetFile = path.join(__dirname, 'tests/dashboard/v2/settings-page-data.test.tsx');
let code = fs.readFileSync(targetFile, 'utf8');

code = code.replace(
  'integrations: { julesApiKey: "sys-key" },',
  'integrations: { julesApiKey: "sys-key", geminiApiKey: "", codexApiKey: "", claudeCodeApiKey: "", githubToken: "" },'
);

fs.writeFileSync(targetFile, code, 'utf8');
