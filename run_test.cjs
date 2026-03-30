const { execSync } = require('child_process');
try {
  execSync('npm run test:coverage -- tests/dashboard/v2/BrowserSessionsMenu.test.tsx', { stdio: 'inherit' });
} catch (e) {
  process.exit(1);
}
