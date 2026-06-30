import { describe, expect, it } from "vitest";
import { sanitizeMemory } from "../../../../../src/domain/settings/settings-sanitizers/memory-sanitizer.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../../../src/repositories/settings-defaults.js";

describe("sanitizeMemory", () => {
  it("returns defaults when input is undefined", () => {
    const result = sanitizeMemory(undefined);
    expect(result).toEqual(DEFAULT_DASHBOARD_SETTINGS.memory);
  });

  it("returns defaults when input has no memory field", () => {
    const result = sanitizeMemory({});
    expect(result).toEqual(DEFAULT_DASHBOARD_SETTINGS.memory);
  });

  it("accepts valid embedding model IDs", () => {
    const result = sanitizeMemory({ memory: { embeddingModel: "bge-small-en-v1.5" } } as any);
    expect(result.embeddingModel).toBe("bge-small-en-v1.5");
  });

  it("rejects invalid embedding model ID", () => {
    const result = sanitizeMemory({ memory: { embeddingModel: "invalid-model" } } as any);
    expect(result.embeddingModel).toBeNull();
  });

  it("accepts external embedding provider configuration", () => {
    const result = sanitizeMemory({
      memory: {
        embeddingProvider: "external_api",
        embeddingModel: "custom-embedding-model",
        externalEmbedding: {
          baseUrl: " https://embeddings.example/v1/embeddings ",
          apiKey: " key ",
          model: " custom-embedding-model ",
          dimensions: 768,
        },
      },
    } as any);

    expect(result.embeddingProvider).toBe("external_api");
    expect(result.embeddingModel).toBe("custom-embedding-model");
    expect(result.externalEmbedding).toEqual({
      baseUrl: "https://embeddings.example/v1/embeddings",
      apiKey: "key",
      model: "custom-embedding-model",
      dimensions: 768,
    });
  });

  it("normalizes remediation controls", () => {
    const result = sanitizeMemory({
      memory: {
        remediationMode: "ai",
        remediationMaxPromotions: 500,
      },
    } as any);

    expect(result.remediationMode).toBe("ai");
    expect(result.remediationMaxPromotions).toBe(100);
  });

  it("clamps promotionThreshold to [0, 1]", () => {
    expect(sanitizeMemory({ memory: { promotionThreshold: 1.5 } } as any).promotionThreshold).toBe(1);
    expect(sanitizeMemory({ memory: { promotionThreshold: -0.5 } } as any).promotionThreshold).toBe(0);
    expect(sanitizeMemory({ memory: { promotionThreshold: 0.8 } } as any).promotionThreshold).toBe(0.8);
  });

  it("enforces minimum of 10 for maxSprintMemories", () => {
    expect(sanitizeMemory({ memory: { maxSprintMemories: 5 } } as any).maxSprintMemories).toBe(10);
    expect(sanitizeMemory({ memory: { maxSprintMemories: 500 } } as any).maxSprintMemories).toBe(500);
  });

  it("enforces minimum of 10 for maxProjectMemories", () => {
    expect(sanitizeMemory({ memory: { maxProjectMemories: 3 } } as any).maxProjectMemories).toBe(10);
  });

  it("reads boolean fields correctly", () => {
    const result = sanitizeMemory({
      memory: { enabled: true, autoCaptureSprint: false, autoCaptureAgent: false, autoPromote: true },
    } as any);
    expect(result.enabled).toBe(true);
    expect(result.autoCaptureSprint).toBe(false);
    expect(result.autoCaptureAgent).toBe(false);
    expect(result.autoPromote).toBe(true);
  });
});
