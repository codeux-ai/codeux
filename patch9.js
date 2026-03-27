import fs from 'fs';
let content = fs.readFileSync('src/app/dependency-factory/core-factory.ts', 'utf8');

// We need to instantiate providerRunner in createCoreDependencies
const importStatements = 'import { ProviderRunner } from "../infrastructure/providers/cli/provider-runner.js";\nimport { DockerRunner } from "../infrastructure/providers/cli/docker-runner.js";\n';
content = content.replace('import type { IProviderRunner }', importStatements + 'import type { IProviderRunner }');

const instantiation = '  const providerRunner = new ProviderRunner(new DockerRunner());\n';
content = content.replace('  const julesSourceResolver = new JulesSourceResolver({', instantiation + '  const julesSourceResolver = new JulesSourceResolver({');

fs.writeFileSync('src/app/dependency-factory/core-factory.ts', content);
