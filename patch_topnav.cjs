const fs = require('fs');
const file = 'dashboard/src/v2/components/TopNav.tsx';
let content = fs.readFileSync(file, 'utf8');

// Project Dropdown
let parts = content.split('aria-expanded={dropdownOpen}');
if (parts.length > 1) {
    if (!parts[1].includes('aria-controls="project-dropdown"')) {
        content = parts[0] + 'aria-expanded={dropdownOpen}\n                        aria-controls="project-dropdown"' + parts[1];
    }
}
if (!content.includes('id="project-dropdown"')) {
    content = content.replace('<div role="listbox" aria-label="Project list"', '<div id="project-dropdown" role="listbox" aria-label="Project list"');
}

// Sprint Dropdown
parts = content.split('aria-expanded={sprintDropdownOpen}');
if (parts.length > 1) {
    if (!parts[1].includes('aria-controls="sprint-dropdown"')) {
        content = parts[0] + 'aria-expanded={sprintDropdownOpen}\n                            aria-controls="sprint-dropdown"' + parts[1];
    }
}
if (!content.includes('id="sprint-dropdown"')) {
    content = content.replace('<div role="listbox" aria-label="Sprint list"', '<div id="sprint-dropdown" role="listbox" aria-label="Sprint list"');
}

// Worker Dropdown
parts = content.split('aria-expanded={workerDropdownOpen}');
if (parts.length > 1) {
    if (!parts[1].includes('aria-controls="worker-dropdown"')) {
        content = parts[0] + 'aria-expanded={workerDropdownOpen}\n                            aria-controls="worker-dropdown"' + parts[1];
    }
}
if (!content.includes('id="worker-dropdown"')) {
    content = content.replace('<div role="listbox" aria-label="Worker list"', '<div id="worker-dropdown" role="listbox" aria-label="Worker list"');
}

fs.writeFileSync(file, content);
