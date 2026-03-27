import fs from 'fs';
let content = fs.readFileSync('src/app/dependency-factory/core-factory.ts', 'utf8');

content = content.replace('import { ProviderRunner } from "../infrastructure/providers/cli/provider-runner.js";\nimport { DockerRunner } from "../infrastructure/providers/cli/docker-runner.js";\nimport type { IProviderRunner } from "../infrastructure/providers/cli/provider-runner.js";', 'import { ProviderRunner } from "../../infrastructure/providers/cli/provider-runner.js";\nimport { DockerRunner } from "../../infrastructure/providers/cli/docker-runner.js";\nimport type { IProviderRunner } from "../../infrastructure/providers/cli/provider-runner.js";');

fs.writeFileSync('src/app/dependency-factory/core-factory.ts', content);

let sprintContent = fs.readFileSync('src/app/dependency-factory/sprint-factory.ts', 'utf8');
sprintContent = sprintContent.replace('providerRunner: coreDeps.providerRunner,', '');
fs.writeFileSync('src/app/dependency-factory/sprint-factory.ts', sprintContent);
