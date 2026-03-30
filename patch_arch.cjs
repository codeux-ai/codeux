const fs = require('fs');
let content = fs.readFileSync('docs/architecture/project-management-implementation.md', 'utf-8');

const old1 = "- markdown import/export for sprints and tasks";
const new1 = "- a structured import flyout supporting markdown import (and placeholders for future providers like Jira), plus export for sprints and tasks";

const old2 = "- internal sprint orchestration resolves project/sprint scope from sqlite instead of markdown task directories";
const new2 = "- planning flows include interactive, background-safe, and dismissible planning overlays with cancellation support\n- quicksprint execution flows are now mutually exclusive with composer create/edit states to maintain focus\n- the sprint ledger uses a refreshed visual treatment with alternating striped rows and real-time client-side search/filtering\n- internal sprint orchestration resolves project/sprint scope from sqlite instead of markdown task directories";

content = content.replace(old1, new1);
content = content.replace(old2, new2);

fs.writeFileSync('docs/architecture/project-management-implementation.md', content);
