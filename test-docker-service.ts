import { DockerService } from './src/services/docker-service.ts';

async function run() {
  const service = new DockerService();
  const containers = await service.listContainers();
  console.log("Containers:", JSON.stringify(containers, null, 2));
}

run();
