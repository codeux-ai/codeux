const fs = require('fs');
const path = require('path');
const targetFile = path.join(__dirname, 'dashboard/src/v2/SettingsPage.tsx');
let code = fs.readFileSync(targetFile, 'utf8');

const importHintsOld = `      setSystemSettings(nextSettings);
      setSaveMessage("Imported missing integration secrets from env/settings.json.");
      setError(null);`;

const importHintsNew = `      await saveSystemSettings(nextSettings);
      await refreshAllSources({ forceOverwrite: true });
      setSaveMessage("Imported missing integration secrets from env/settings.json.");
      setError(null);`;

code = code.replace(importHintsOld, importHintsNew);

// Add saveSystemSettings dependency
code = code.replace('}, [systemSettings]);', '}, [systemSettings, refreshAllSources]);');

fs.writeFileSync(targetFile, code, 'utf8');
