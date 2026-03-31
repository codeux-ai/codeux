const fs = require('fs');

let testCode = fs.readFileSync('tests/dashboard/v2/settings-page-state.test.tsx', 'utf-8');

// Use `waitFor` on the mock itself for robust asynchronous assertion
testCode = testCode.replace('expect(mockSaveSystem).toHaveBeenCalled();', 'await waitFor(() => expect(mockSaveSystem).toHaveBeenCalled());');
testCode = testCode.replace('expect(mockSaveProject).toHaveBeenCalled();', 'await waitFor(() => expect(mockSaveProject).toHaveBeenCalled());');
testCode = testCode.replace('expect(mockFetchExternal).toHaveBeenCalled();', 'await waitFor(() => expect(mockFetchExternal).toHaveBeenCalled());');

fs.writeFileSync('tests/dashboard/v2/settings-page-state.test.tsx', testCode, 'utf-8');
console.log("Using waitFor for assertions");
