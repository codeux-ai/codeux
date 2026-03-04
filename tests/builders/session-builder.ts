import type { JulesSession, ProviderId } from "../../src/contracts/app-types.js";

export function buildMockSession(overrides: Partial<JulesSession> = {}): JulesSession {
  return {
    id: "session-123",
    name: "sessions/session-123",
    title: "Sprint 1: [task-01] Default Task",
    state: "RUNNING",
    provider: "jules" as ProviderId,
    prompt: "Default session prompt",
    ...overrides,
  };
}
