const fs = require('fs');
const path = 'tests/dashboard/v2/components/sprints/SprintImportMenu.test.tsx';
let content = fs.readFileSync(path, 'utf8');
content = content.replace(/getByRole\("button", \{ name: \/import\/i \}\)/g, 'getAllByRole("button").find(btn => btn.textContent?.includes("Import") && !btn.textContent?.includes("Markdown"))');
fs.writeFileSync(path, content);
