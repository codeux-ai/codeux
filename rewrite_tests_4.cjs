const fs = require('fs');
const path = require('path');
const targetFile = path.join(__dirname, 'tests/dashboard/v2/settings-page-data.test.tsx');
let code = fs.readFileSync(targetFile, 'utf8');

code = code.replace(
  'const generalCat = screen.getByText("Scope, runtime, and automation posture");',
  'const generalCat = screen.getAllByText("Scope, runtime, and automation posture")[0];'
);

code = code.replace(
  'const modelsCat = screen.getByText("Provider routing, models, and weighting");',
  'const modelsCat = screen.getAllByText("Provider routing, models, and weighting")[0];'
);

fs.writeFileSync(targetFile, code, 'utf8');
