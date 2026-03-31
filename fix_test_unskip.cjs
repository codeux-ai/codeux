const fs = require('fs');
let testCode = fs.readFileSync('tests/dashboard/v2/settings-page-state.test.tsx', 'utf-8');
testCode = testCode.replace(/it\.skip/g, 'it');
fs.writeFileSync('tests/dashboard/v2/settings-page-state.test.tsx', testCode, 'utf-8');
