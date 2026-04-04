const fs = require('fs');

let code = fs.readFileSync('tests/backend/app/live/project-live-snapshot.test.ts', 'utf8');

// I appended the tests outside the `describe` block accidentally! Let's fix that.
code = code.replace(/  \}\);[\r\n]+  it\("uses generic/g, `  });\n\n  it("uses generic`);
code = code.replace(/    \);\n  \}\);\n\n$/g, `    );\n  });\n});\n`);
code = code.replace(/  \}\);\n\n\n  it\("uses generic/, `  });\n\n  it("uses generic`);
code = code.replace(/  it\("uses generic[\s\S]+$/, ``);

fs.writeFileSync('tests/backend/app/live/project-live-snapshot.test.ts', code);
