import fs from 'fs';
let content = fs.readFileSync('src/app/dependency-factory/sprint-factory.ts', 'utf8');

content = content.replace('getGithubToken: () => context.getGithubToken(),\n      logger: logger.child({ component: "worker-inbox-reply-service" }),\n    });', 'getGithubToken: () => context.getGithubToken(),\n      providerRunner: coreDeps.providerRunner,\n      logger: logger.child({ component: "worker-inbox-reply-service" }),\n    });');

fs.writeFileSync('src/app/dependency-factory/sprint-factory.ts', content);
