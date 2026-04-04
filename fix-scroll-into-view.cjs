const fs = require('fs');
let content = fs.readFileSync('dashboard/src/v2/components/ui/AvantgardeSelect.tsx', 'utf8');

// Guard scrollIntoView
content = content.replace(
  'activeOptionRef.current.scrollIntoView({ block: "nearest" });',
  'if (typeof activeOptionRef.current.scrollIntoView === "function") {\n        activeOptionRef.current.scrollIntoView({ block: "nearest" });\n      }'
);

fs.writeFileSync('dashboard/src/v2/components/ui/AvantgardeSelect.tsx', content);
