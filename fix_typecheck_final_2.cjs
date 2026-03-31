const fs = require('fs');

// We don't even use ProviderId or InvocationRoutingId in SettingsGeneralPanel
let content = fs.readFileSync('dashboard/src/v2/components/settings/panels/SettingsGeneralPanel.tsx', 'utf-8');
content = content.replace('import type { ProjectSettings } from "../../../../../../src/contracts/settings-scope-types.js";\nimport type { ProviderId, InvocationRoutingId } from "../../../types.js";',
  'import type { ProjectSettings } from "../../../../../../src/contracts/settings-scope-types.js";');
fs.writeFileSync('dashboard/src/v2/components/settings/panels/SettingsGeneralPanel.tsx', content, 'utf-8');
