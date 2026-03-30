const fs = require('fs');
const file = 'src/app/lifecycle/dashboard-lifecycle-service.ts';
let code = fs.readFileSync(file, 'utf8');

const search = `    getLiveSnapshot: (projectIdHint) => getProjectLiveSnapshot({
      projectManagementRepository: deps.projectManagementRepository,
      projectRuntimeRepository: deps.projectRuntimeRepository,
      getProjectExecutionSnapshot,
      getGitStatus: deps.getGitStatus
    }, projectIdHint),`;

const replace = `    getLiveSnapshot: (projectIdHint) => getProjectLiveSnapshot({
      projectManagementRepository: deps.projectManagementRepository,
      projectRuntimeRepository: deps.projectRuntimeRepository,
      getProjectExecutionSnapshot,
      getGitStatus: deps.getGitStatus,
      logger: deps.logger.child({ component: "project-live-snapshot" })
    }, projectIdHint),`;

code = code.replace(search, replace);
fs.writeFileSync(file, code);
