const fs = require('fs');

let testCode = fs.readFileSync('tests/dashboard/v2/settings-page-state.test.tsx', 'utf-8');

// Unskip tests
testCode = testCode.replace('it.skip("handles saving system settings",', 'it("handles saving system settings",');
testCode = testCode.replace('it.skip("handles saving project settings",', 'it("handles saving project settings",');
testCode = testCode.replace('it.skip("handles import hints",', 'it("handles import hints",');

// Using standard promise resolution waiting pattern instead of arbitrary timeouts
testCode = testCode.replace(/await new Promise\(\(resolve\) => setTimeout\(resolve, 0\)\);/g, 'await Promise.resolve(); await Promise.resolve();');
testCode = testCode.replace(/await new Promise\(\(resolve\) => setTimeout\(resolve, 10\)\);/g, 'await Promise.resolve(); await Promise.resolve();');
testCode = testCode.replace(/await new Promise\(\(resolve\) => setTimeout\(resolve, 50\)\);/g, 'await Promise.resolve(); await Promise.resolve();');
testCode = testCode.replace(/await new Promise\(\(resolve\) => setTimeout\(resolve, 200\)\);/g, 'await Promise.resolve(); await Promise.resolve();');
testCode = testCode.replace(/await new Promise\(r => setTimeout\(r, 10\)\);/g, 'await Promise.resolve(); await Promise.resolve();');

fs.writeFileSync('tests/dashboard/v2/settings-page-state.test.tsx', testCode, 'utf-8');
console.log("Fixed test waits.");
