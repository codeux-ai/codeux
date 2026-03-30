const fs = require('fs');
const file = 'src/app/lifecycle/dashboard-lifecycle-service.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  /getProjectLiveSnapshot: \(projectIdHint\) => getProjectLiveSnapshot\(\{\n\s*projectManagementRepository: deps.projectManagementRepository,\n\s*projectRuntimeRepository: deps.projectRuntimeRepository,\n\s*getProjectExecutionSnapshot,\n\s*getGitStatus: deps.getGitStatus\n\s*\}, projectIdHint\),/g,
  `getProjectLiveSnapshot: (projectIdHint) => getProjectLiveSnapshot({
      projectManagementRepository: deps.projectManagementRepository,
      projectRuntimeRepository: deps.projectRuntimeRepository,
      getProjectExecutionSnapshot,
      getGitStatus: deps.getGitStatus,
      logger: deps.logger.child({ component: "project-live-snapshot" })
    }, projectIdHint),`
);

code = code.replace(
  /getLiveSnapshot: \(projectIdHint\) => getProjectLiveSnapshot\(\{\n\s*projectManagementRepository: deps.projectManagementRepository,\n\s*projectRuntimeRepository: deps.projectRuntimeRepository,\n\s*getProjectExecutionSnapshot: deps.executionRepository.getProjectExecutionSnapshot.bind\(deps.executionRepository\),\n\s*getGitStatus: deps.getGitStatus\n\s*\}, projectIdHint\)/g,
  `getLiveSnapshot: (projectIdHint) => getProjectLiveSnapshot({
      projectManagementRepository: deps.projectManagementRepository,
      projectRuntimeRepository: deps.projectRuntimeRepository,
      getProjectExecutionSnapshot: deps.executionRepository.getProjectExecutionSnapshot.bind(deps.executionRepository),
      getGitStatus: deps.getGitStatus,
      logger: deps.logger.child({ component: "project-live-snapshot" })
    }, projectIdHint)`
);


fs.writeFileSync(file, code);
console.log('patched lifecycle');
