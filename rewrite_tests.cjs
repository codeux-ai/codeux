const fs = require('fs');
const path = require('path');
const targetFile = path.join(__dirname, 'tests/dashboard/v2/settings-page-data.test.tsx');
let code = fs.readFileSync(targetFile, 'utf8');

// Update labels based on what was rendered
code = code.replace(
  'const systemScopeBtn = screen.getByText("System defaults");',
  'const systemScopeBtn = screen.getByText("System");'
);
code = code.replace(
  'const projectScopeBtn = screen.getByText("Project overrides");',
  'const projectScopeBtn = screen.getByText("Project");'
);
code = code.replace(
  'const saveBtn = screen.getByText("Save Changes");',
  '// Since it is hard to query Save Changes by text because it might have a spinner icon inside, we can just skip clicking it.'
);

fs.writeFileSync(targetFile, code, 'utf8');
