const fs = require('fs');
const path = require('path');
const targetFile = path.join(__dirname, 'tests/dashboard/v2/settings-page-data.test.tsx');
let code = fs.readFileSync(targetFile, 'utf8');

code = code.replace(
  'const systemScopeBtn = screen.getByText("System");',
  'const systemScopeBtn = screen.getByRole("button", { name: "System" });'
);
code = code.replace(
  'const projectScopeBtn = screen.getByText("Project");',
  'const projectScopeBtn = screen.getByRole("button", { name: "Project" });'
);

fs.writeFileSync(targetFile, code, 'utf8');
