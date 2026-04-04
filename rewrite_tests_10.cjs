const fs = require('fs');
const path = require('path');
const targetFile = path.join(__dirname, 'tests/dashboard/v2/settings-page-data.test.tsx');
let code = fs.readFileSync(targetFile, 'utf8');

// I need to find the failing test and fix it. The failing test is:
// "should stable system/project scope switching"
// Error: Cannot read properties of undefined (reading 'provider')

// Let's add provider: "jules" to invocationRoutes
const mockRouting = {
  task_coding: { provider: "jules", allowedProviders: ["jules", "gemini"], providers: {} },
  planning: { provider: "gemini", allowedProviders: ["jules", "gemini"], providers: {} },
  dashboard_reply: { provider: "jules", allowedProviders: ["jules", "gemini"], providers: {} },
  clarification_reply: { provider: "jules", allowedProviders: ["jules", "gemini"], providers: {} },
  ci_fix: { provider: "jules", allowedProviders: ["jules", "gemini"], providers: {} },
  merge_conflict: { provider: "jules", allowedProviders: ["jules", "gemini"], providers: {} }
};

// Update the mocks in the file.
// The file has two mockRouting places from previous scripts. Let's just redefine the whole string.
code = code.replace(/invocationRouting: \{.*\}/g, `invocationRouting: ${JSON.stringify(mockRouting)}`);

fs.writeFileSync(targetFile, code, 'utf8');
