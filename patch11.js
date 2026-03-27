import fs from 'fs';
let content = fs.readFileSync('src/app/dependency-factory/core-factory.ts', 'utf8');

content = content.replace('const julesSourceResolver = new JulesSourceResolver(julesApi);', 'const providerRunner = new ProviderRunner(new DockerRunner());\n  const julesSourceResolver = new JulesSourceResolver(julesApi);');

fs.writeFileSync('src/app/dependency-factory/core-factory.ts', content);

let sprintContent = fs.readFileSync('src/app/dependency-factory/sprint-factory.ts', 'utf8');
sprintContent = sprintContent.replace('getGithubToken: () => context.getEffectiveGithubToken(),\n    logger:', 'getGithubToken: () => context.getEffectiveGithubToken(),\n    providerRunner: coreDeps.providerRunner,\n    logger:');
fs.writeFileSync('src/app/dependency-factory/sprint-factory.ts', sprintContent);
