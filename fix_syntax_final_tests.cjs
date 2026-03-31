const fs = require('fs');
let content = fs.readFileSync('tests/dashboard/v2/settings-page-state.test.tsx', 'utf-8');
content = content.replace("mockFetchExternal = vi.spyOn(dashboardApi, 'fetchExternalSettingsHints').mockResolvedValue({", "mockFetchExternal = vi.spyOn(dashboardApi, 'fetchExternalSettingsHints').mockResolvedValue({});\n  });");
fs.writeFileSync('tests/dashboard/v2/settings-page-state.test.tsx', content, 'utf-8');
