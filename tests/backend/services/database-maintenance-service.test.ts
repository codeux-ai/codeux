import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseMaintenanceService } from "../../../src/services/database-maintenance-service.js";

describe("DatabaseMaintenanceService", () => {
  let mockAppDbStorage: any;
  let mockSessionTracking: any;
  let mockSettingsRepository: any;
  let mockLogger: any;
  let mockAppDb: any;
  let mockSessionDb: any;
  let mockSettingsDb: any;

  beforeEach(() => {
    mockAppDb = {
      prepare: vi.fn(() => ({ run: vi.fn(() => ({ changes: 1 })) })),
      exec: vi.fn(),
    };
    mockSessionDb = {
      prepare: vi.fn(() => ({ run: vi.fn(() => ({ changes: 2 })) })),
      exec: vi.fn(),
    };
    mockSettingsDb = {
      exec: vi.fn(),
    };

    mockAppDbStorage = { getDatabase: vi.fn(() => mockAppDb) };
    mockSessionTracking = { getDatabase: vi.fn(() => mockSessionDb) };

    mockSettingsRepository = {
      getSystemSettings: vi.fn(() => ({
        runtime: {
          dbAutoVacuumOnStartup: true,
          dbPruningEnabled: true,
          dbRetentionDays: 14,
        },
      })),
      getDatabase: vi.fn(() => mockSettingsDb),
    };

    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };
  });

  const createService = () => new DatabaseMaintenanceService({
    appDbStorage: mockAppDbStorage,
    sessionTracking: mockSessionTracking,
    settingsRepository: mockSettingsRepository,
    logger: mockLogger,
  });

  it("skips pruning when disabled", async () => {
    mockSettingsRepository.getSystemSettings.mockReturnValueOnce({
      runtime: { dbPruningEnabled: false, dbAutoVacuumOnStartup: false },
    });
    const service = createService();
    const result = await service.runMaintenance();

    expect(result.pruningSkipped).toBe(true);
    expect(result.prunedTaskRuns).toBe(0);
    expect(mockAppDb.prepare).not.toHaveBeenCalled();
  });

  it("skips vacuum when disabled", async () => {
    mockSettingsRepository.getSystemSettings.mockReturnValueOnce({
      runtime: { dbAutoVacuumOnStartup: false, dbPruningEnabled: false },
    });
    const service = createService();
    const result = await service.runMaintenance();

    expect(result.vacuumSkipped).toBe(true);
    expect(mockAppDb.exec).not.toHaveBeenCalledWith("VACUUM;");
  });

  it("clamps invalid retention values", async () => {
    mockSettingsRepository.getSystemSettings.mockReturnValueOnce({
      runtime: { dbRetentionDays: -5, dbPruningEnabled: true, dbAutoVacuumOnStartup: false },
    });
    const service = createService();
    await service.runMaintenance();

    // Check logger info to see that it used a positive clamped value for retentionDays
    expect(mockLogger.info).toHaveBeenCalledWith(
      "Starting database maintenance...",
      expect.objectContaining({ retentionDays: 14 }) // negative is fallback to 14
    );
  });

  it("records WAL checkpoint busy failures", async () => {
    mockSettingsRepository.getSystemSettings.mockReturnValueOnce({
      runtime: { dbAutoVacuumOnStartup: false, dbPruningEnabled: false },
    });
    mockAppDb.exec.mockImplementation(() => { throw new Error("database is locked"); });

    const service = createService();
    const result = await service.runMaintenance();

    expect(result.checkpointFailures).toContain("app.db");
    expect(mockLogger.warn).toHaveBeenCalledWith("WAL checkpoint failed", expect.any(Object));
  });

  it("reports successful pruning counts", async () => {
    const service = createService();
    const result = await service.runMaintenance();

    expect(result.pruningSkipped).toBe(false);
    expect(result.prunedTaskRuns).toBe(1); // 1 from mockAppDb
    expect(result.prunedAttentionItems).toBe(1);
    expect(result.prunedRealtimeEvents).toBe(1);
    expect(result.prunedProviderActivities).toBe(2); // 2 from mockSessionDb
    expect(result.prunedProviderSessions).toBe(2);
    expect(result.vacuumFailed).toBe(false);
    expect(result.checkpointFailures).toEqual([]);
  });
});