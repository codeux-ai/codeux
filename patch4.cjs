const fs = require('fs');
const path = 'tests/dashboard/v2/sprints-page.test.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(/const newSprintBtn = screen.getByRole\("button", \{ name: \/new sprint\/i \}\);/g, 'const newSprintBtn = screen.getAllByRole("button").find(b => b.textContent?.toLowerCase().includes("new sprint"));');

fs.writeFileSync(path, content);
