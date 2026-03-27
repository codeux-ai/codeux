import fs from 'fs';
let content = fs.readFileSync('tests/backend/services/worker-inbox-reply-service.test.ts', 'utf8');

content = content.replace(/\/\/ vi\.mock, \(\) => \(\{\n  runCommandStrict: vi\.fn\(\),\n\}\)\);/, '');

fs.writeFileSync('tests/backend/services/worker-inbox-reply-service.test.ts', content);
