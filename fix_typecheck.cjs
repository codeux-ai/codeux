const fs = require('fs');
let content = fs.readFileSync('dashboard/src/v2/components/settings/panels/SettingsGeneralPanel.tsx', 'utf-8');
content = content.replace('import type { ProjectSettings, ProviderId, InvocationRoutingId } from "../../../../../types.js";', 'import type { ProjectSettings, ProviderId, InvocationRoutingId } from "../../../../../src/contracts/settings-scope-types.js";');
fs.writeFileSync('dashboard/src/v2/components/settings/panels/SettingsGeneralPanel.tsx', content, 'utf-8');
