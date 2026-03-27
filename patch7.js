import fs from 'fs';
let content = fs.readFileSync('src/app/dependency-factory/sprint-factory.ts', 'utf8');

content = content.replace('getGithubToken: () => context.getEffectiveGithubToken(),', 'getGithubToken: () => context.getEffectiveGithubToken(),\n    providerRunner: coreDeps.providerRunner,');

fs.writeFileSync('src/app/dependency-factory/sprint-factory.ts', content);
