import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ChatProviderRepository } from "../../../src/repositories/chat-provider-repository.js";
import {
  ChatProviderSessionRuntimeService,
  type ChatProviderSessionRuntimeDriver,
} from "../../../src/services/chat-provider-session-runtime-service.js";

const storages: AppDbStorage[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const storage of storages.splice(0).reverse()) storage.close();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("ChatProviderSessionRuntimeService", () => {
  it("starts a profile-required session once across repeated starts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-07T00:00:00.000Z"));
    const context = await createContext();
    const connection = context.repository.createConnection({
      providerKind: "discord",
      displayName: "Discord session",
      bridgeMode: "webhook",
      status: "active",
    });
    const driver: ChatProviderSessionRuntimeDriver = {
      supports: vi.fn().mockReturnValue(true),
      run: vi.fn().mockResolvedValue({ outcome: "completed", providerState: { cursor: "done" } }),
    };
    const service = new ChatProviderSessionRuntimeService({
      chatProviderRepository: context.repository,
      driver,
      random: () => 0.5,
    });

    await service.start();
    await service.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(driver.run).toHaveBeenCalledTimes(1);
    expect(context.repository.getProviderSession(connection.id, `connection:${connection.id}`)).toMatchObject({
      state: expect.objectContaining({ status: "completed", resumable: false, providerState: { cursor: "done" } }),
    });
    await service.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("persists an interrupted session as resumable and completes it after restart", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-07T00:00:00.000Z"));
    const context = await createContext();
    const connection = context.repository.createConnection({
      providerKind: "discord",
      displayName: "Restart session",
      bridgeMode: "webhook",
      status: "active",
    });
    let runStarted: (() => void) | null = null;
    const started = new Promise<void>((resolve) => { runStarted = resolve; });
    const firstDriver: ChatProviderSessionRuntimeDriver = {
      supports: () => true,
      run: vi.fn((runContext) => new Promise((_resolve, reject) => {
        runStarted?.();
        runContext.signal.addEventListener("abort", () => reject(Object.assign(new Error("stopped"), {
          code: "shutdown",
        })), { once: true });
      })),
    };
    const first = new ChatProviderSessionRuntimeService({
      chatProviderRepository: context.repository,
      driver: firstDriver,
      random: () => 0.5,
    });
    await first.start();
    await vi.advanceTimersByTimeAsync(0);
    await started;
    await first.stop();

    expect(context.repository.getProviderSession(connection.id, `connection:${connection.id}`)?.state.status).toBe("resumable");
    expect(vi.getTimerCount()).toBe(0);

    const secondDriver: ChatProviderSessionRuntimeDriver = {
      supports: () => true,
      run: vi.fn().mockResolvedValue({ outcome: "completed" }),
    };
    const second = new ChatProviderSessionRuntimeService({
      chatProviderRepository: context.repository,
      driver: secondDriver,
      random: () => 0.5,
    });
    await second.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(secondDriver.run).toHaveBeenCalledTimes(1);
    expect(context.repository.getProviderSession(connection.id, `connection:${connection.id}`)?.state.status).toBe("completed");
    await second.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels reconnect timers before storage shutdown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-07T00:00:00.000Z"));
    const context = await createContext();
    context.repository.createConnection({
      providerKind: "discord",
      displayName: "Reconnect session",
      bridgeMode: "webhook",
      status: "active",
    });
    const driver: ChatProviderSessionRuntimeDriver = {
      supports: () => true,
      run: vi.fn().mockResolvedValue({ outcome: "reconnect", retryAfterMs: 30_000, errorCode: "gateway_closed" }),
    };
    const service = new ChatProviderSessionRuntimeService({
      chatProviderRepository: context.repository,
      driver,
      random: () => 0.5,
    });
    await service.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(driver.run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await service.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

async function createContext(): Promise<{ repository: ChatProviderRepository }> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-chat-provider-session-"));
  tempDirs.push(tempDir);
  const storage = new AppDbStorage(path.join(tempDir, "app.db"));
  storages.push(storage);
  return { repository: new ChatProviderRepository(storage) };
}
