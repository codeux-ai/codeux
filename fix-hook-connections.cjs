const fs = require('fs');
let hook = fs.readFileSync('dashboard/src/v2/hooks/use-chat-page-data.ts', 'utf8');

if (!hook.includes('    connections,')) {
    hook = hook.replace(
        '    invocations,',
        '    invocations,\n    connections,'
    );
    fs.writeFileSync('dashboard/src/v2/hooks/use-chat-page-data.ts', hook);
}
