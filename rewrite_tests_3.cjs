const fs = require('fs');
const path = require('path');
const targetFile = path.join(__dirname, 'tests/dashboard/v2/settings-page-data.test.tsx');
let code = fs.readFileSync(targetFile, 'utf8');

code = code.replace(
  'const systemScopeBtn = screen.getByRole("button", { name: "System" });',
  'const systemScopeBtns = screen.getAllByRole("button", { name: "System" });\n    const systemScopeBtn = systemScopeBtns[0];'
);
code = code.replace(
  'const projectScopeBtn = screen.getByRole("button", { name: "Project" });',
  'const projectScopeBtns = screen.getAllByRole("button", { name: "Project" });\n    const projectScopeBtn = projectScopeBtns[0];'
);

fs.writeFileSync(targetFile, code, 'utf8');
