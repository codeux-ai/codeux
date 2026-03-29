const fs = require('fs');
let content = fs.readFileSync('docs/dashboard/dashboard-guide.md', 'utf-8');

const old1 = "- Sprints page is project-scoped, creates sprint records in sqlite, and exposes markdown import/export controls";
const new1 = "- Sprints page is project-scoped, creates sprint records in sqlite, and exposes a structured Import flyout with Markdown (and soon Jira) capabilities, plus markdown export controls";

const old2 = "- The planning overlay includes a `Cancel` button that aborts the in-flight planning or improvement request via AbortController, immediately clearing the overlay and returning the composer to its editable state";
const new2 = "- The planning overlay includes a `Cancel` button that aborts the in-flight planning or improvement request via AbortController, safely clearing the dismissible overlay and returning the composer to its editable state without navigating away";

const old3 = "- The sprint ledger below the showcase renders contiguous striped rows (alternating light backgrounds) with a real-time search field that filters by sprint key, name, status, or goal text; a live result counter shows filtered vs total counts and a clear button resets the query";
const new3 = "- The refreshed sprint ledger below the showcase renders contiguous striped rows (alternating light backgrounds) with a real-time search field that filters by sprint key, name, status, or goal text; a live result counter shows filtered vs total counts and a clear button resets the query";

const old4 = "- The in-page sprint composer collapses into a stacked single-column layout on smaller screens, and both create and edit now use that same inline flow";
const new4 = "- The in-page sprint composer collapses into a stacked single-column layout on smaller screens, and both create and edit now use that same inline flow. The Quicksprint panel and the Sprint Composer are mutually exclusive; opening one automatically dismisses the other to maintain focus.";

content = content.replace(old1, new1);
content = content.replace(old2, new2);
content = content.replace(old3, new3);
content = content.replace(old4, new4);

fs.writeFileSync('docs/dashboard/dashboard-guide.md', content);
