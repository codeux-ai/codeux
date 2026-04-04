const fs = require('fs');

const testFile = 'tests/backend/services/planning-agent-service.test.ts';
let code = fs.readFileSync(testFile, 'utf8');

// Add timeout regression test
const timeoutTest = `
  it("throws timeout error when worker reply takes too long", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-planning-timeout-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    await fs.mkdir(path.join(repoPath, ".sprint-os", "agents"), { recursive: true });
    await fs.writeFile(
      path.join(repoPath, ".sprint-os", "agents", "planning_agent.md"),
      "Turn sprint goals into concrete executable tasks.\n",
      "utf8",
    );

    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const connectionRepository = new ConnectionChatRepository(storage);
    const settingsRepository = new SettingsRepository(path.join(dir, "settings.db"));
    const syncService = new AgentPresetSyncService({
      projectManagementRepository: projectRepository,
      agentPresetRepository,
      settingsRepository,
      projectRoot: dir,
    });

    const service = new PlanningAgentService({
      projectManagementRepository: projectRepository,
      connectionChatRepository: connectionRepository,
      settingsRepository,
      agentPresetSyncService: syncService,
      executionControlService: { orchestrateSprint: vi.fn() } as any,
    });
    // @ts-ignore - access private property for testing
    const originalPollMs = service.PLANNING_WORKER_POLL_MS;
    // @ts-ignore
    service.PLANNING_WORKER_POLL_MS = 10;

    // For this test, we have to mock waitUntil or adjust constants. Since waitUntil is imported,
    // it is easier to use fake timers, but wait-until uses async polling, so fake timers can be tricky.
    // Let's mock the waitUntil function.
    // Actually, wait-until checks Date.now(). Let's just use vitest fake timers.
  });
`;
// Let's write the tests using the actual wait-until timeout. wait-until timeout is 5 mins by default, so we mock it.
