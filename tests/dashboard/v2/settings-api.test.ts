import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSettingsApiCacheForTests,
  fetchProjectEffectiveSettings,
  saveProjectSettings,
  saveProjectDesignGuidanceSettings,
  saveProjectTechstackSettings,
  saveSystemSettings,
} from "../../../dashboard/src/v2/lib/settings-api.js";

const jsonResponse = (body: unknown): Response => (
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
);

describe("settings-api", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearSettingsApiCacheForTests();
  });

  it("does not share abortable effective-settings requests with stable consumers", async () => {
    const abortableController = new AbortController();
    const abortableRequest = new Promise<Response>((_, reject) => {
      abortableController.signal.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    });
    const stableSettings = {
      settings: { automationLevel: "FULL" },
      sources: {},
    };

    vi.stubGlobal("fetch", vi.fn((_: string, init?: RequestInit) => {
      if (init?.signal) {
        return abortableRequest;
      }
      return Promise.resolve(jsonResponse(stableSettings));
    }));

    const abortable = fetchProjectEffectiveSettings("project-1", { signal: abortableController.signal });
    const stable = fetchProjectEffectiveSettings("project-1");
    abortableController.abort();

    await expect(abortable).rejects.toThrow("Aborted");
    await expect(stable).resolves.toEqual(stableSettings);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("bypasses the renderer effective-settings cache when reload is requested", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        settings: { automationLevel: "FULL" },
        sources: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        settings: { automationLevel: "LOW" },
        sources: { automationLevel: "project" },
      })));

    await expect(fetchProjectEffectiveSettings("project-1")).resolves.toMatchObject({
      settings: { automationLevel: "FULL" },
    });
    await expect(fetchProjectEffectiveSettings("project-1", { cache: "reload" })).resolves.toMatchObject({
      settings: { automationLevel: "LOW" },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("preserves existing project override fields when saving only the techstack", async () => {
    const existingOverride = {
      jira: {
        host: "https://jira.example.test",
        email: "user@example.test",
        apiToken: "secret-token",
        defaultProject: "APP",
      },
      agents: {
        qualityAssurance: {
          taskCompletion: { enabled: false },
          maxTaskReviewRuns: 5,
        },
      },
      techstack: {
        selectedTechstackId: null,
        applicationKind: null,
      },
    };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/projects/project-1/settings" && !init?.method) {
        return Promise.resolve(jsonResponse(existingOverride));
      }
      if (url === "/api/projects/project-1/settings" && init?.method === "PUT") {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    await saveProjectTechstackSettings("project-1", {
      selectedTechstackId: "code-ux-internal",
      applicationKind: "web",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, putInit] = fetchMock.mock.calls[1]!;
    expect(JSON.parse(String(putInit?.body))).toEqual({
      ...existingOverride,
      jira: {
        host: "https://jira.example.test",
        email: "user@example.test",
        defaultProject: "APP",
      },
      techstack: {
        selectedTechstackId: "code-ux-internal",
        applicationKind: "web",
      },
    });
  });

  it("preserves existing project override fields when saving only design guidance", async () => {
    const existingOverride = {
      jira: {
        host: "https://jira.example.test",
        email: "user@example.test",
        apiToken: "secret-token",
        defaultProject: "APP",
      },
      designGuidance: {
        selectedTechStackId: "none",
        selectedStyleguideId: "none",
        hideDefaultStyleguides: false,
        customTechStacks: [],
        customStyleguides: [],
      },
    };
    const nextGuidance = {
      ...existingOverride.designGuidance,
      selectedTechStackId: "internal-ui-stack",
    };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/projects/project-1/settings" && !init?.method) {
        return Promise.resolve(jsonResponse(existingOverride));
      }
      if (url === "/api/projects/project-1/settings" && init?.method === "PUT") {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    await saveProjectDesignGuidanceSettings("project-1", nextGuidance);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, putInit] = fetchMock.mock.calls[1]!;
    expect(JSON.parse(String(putInit?.body))).toEqual({
      ...existingOverride,
      jira: {
        host: "https://jira.example.test",
        email: "user@example.test",
        defaultProject: "APP",
      },
      designGuidance: nextGuidance,
    });
  });

  it("sends credential references and non-secret speech and embedding configuration only", async () => {
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => Promise.resolve(jsonResponse(url === "/api/system-settings" ? {} : { ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    const settings = {
      defaults: {
        speech: {
          externalTranscription: {
            baseUrl: "https://speech.example.test/transcriptions",
            apiKey: "sentinel-transcription-secret",
            apiKeyCredentialRef: { credentialId: "transcription-credential", capability: "read" },
            model: "whisper-1",
          },
          synthesis: {
            externalSynthesis: {
              baseUrl: "https://speech.example.test/synthesis",
              apiKey: "sentinel-synthesis-secret",
              apiKeyCredentialRef: { credentialId: "synthesis-credential", capability: "read" },
              model: "tts-1",
              voice: "alloy",
              format: "mp3",
            },
          },
        },
        memory: {
          externalEmbedding: {
            baseUrl: "https://embedding.example.test",
            apiKey: "sentinel-embedding-secret",
            apiKeyCredentialRef: { credentialId: "embedding-credential", capability: "read" },
            model: "text-embedding-3-small",
            dimensions: 1536,
          },
        },
      },
    };

    await saveSystemSettings(settings as never);
    await saveProjectSettings("project-1", settings.defaults as never);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      const payload = JSON.parse(String(init?.body));
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toMatch(/sentinel-|\"apiKey\"/);
      expect(payload.defaults?.speech.externalTranscription.apiKeyCredentialRef
        ?? payload.speech.externalTranscription.apiKeyCredentialRef).toEqual({
        credentialId: "transcription-credential",
        capability: "read",
      });
      expect(payload.defaults?.speech.synthesis.externalSynthesis.apiKeyCredentialRef
        ?? payload.speech.synthesis.externalSynthesis.apiKeyCredentialRef).toEqual({
        credentialId: "synthesis-credential",
        capability: "read",
      });
      expect(payload.defaults?.memory.externalEmbedding.apiKeyCredentialRef
        ?? payload.memory.externalEmbedding.apiKeyCredentialRef).toEqual({
        credentialId: "embedding-credential",
        capability: "read",
      });
    }
  });
});
