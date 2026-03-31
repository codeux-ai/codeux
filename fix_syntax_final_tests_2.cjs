const fs = require('fs');
let content = fs.readFileSync('tests/dashboard/v2/settings-page-state.test.tsx', 'utf-8');
content = content.replace("});\n});\n  });\n\n  it(\"initializes with general category and system scope\",", "});\n\n  it(\"initializes with general category and system scope\",");
fs.writeFileSync('tests/dashboard/v2/settings-page-state.test.tsx', content, 'utf-8');
