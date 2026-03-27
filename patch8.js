import fs from 'fs';
let content = fs.readFileSync('src/app/dependency-factory/core-factory.ts', 'utf8');

// Add providerRunner to CoreDependencies
content = content.replace('export interface CoreDependencies {', 'import type { IProviderRunner } from "../infrastructure/providers/cli/provider-runner.js";\n\nexport interface CoreDependencies {\n  providerRunner: IProviderRunner;');

// Expose it in the return statement
content = content.replace('return {\n    logger,', 'return {\n    providerRunner,\n    logger,');

// Wait, where is providerRunner instantiated?
fs.writeFileSync('src/app/dependency-factory/core-factory.ts', content);
