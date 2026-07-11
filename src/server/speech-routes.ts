import type { Express, Request, Response } from "express";
import multer from "multer";
import type { SpeechTranscriptionResult } from "../contracts/speech-types.js";
import type { SpeechTranscriptionService } from "../services/speech-transcription-service.js";
import type { SpeechSynthesisService } from "../services/speech-synthesis-service.js";
import type { SpeechModelManager } from "../services/speech-model-manager.js";
import {
  MAX_SPEECH_AUDIO_BYTES,
  buildSpeechRequestMetadata,
  parseOptionalDurationSeconds,
  resolveKnownAudioDurationSeconds,
  validateSpeechAudio,
} from "../services/speech-audio-utils.js";
import { asyncRoute } from "./route-utils.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SPEECH_AUDIO_BYTES, files: 1 },
});

export interface SpeechRouteDependencies {
  speechTranscriptionService: Pick<SpeechTranscriptionService, "transcribe">;
  speechSynthesisService?: Pick<SpeechSynthesisService, "synthesize">;
  speechModelManager?: Pick<SpeechModelManager, "listModels" | "hasModel" | "validateDownloadAcceptance" | "downloadModel" | "cancelDownload" | "deleteModel">;
}

function resultStatus(result: SpeechTranscriptionResult): number {
  if (result.ok) return 200;
  switch (result.error.code) {
    case "permission_denied":
      return 403;
    case "provider_failure":
      return 502;
    case "unsupported_audio":
    case "missing_local_model":
    case "missing_model":
    case "client_error":
    default:
      return 400;
  }
}

function uploadSingleAudio(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    upload.single("audio")(req, res, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function uploadErrorResult(error: unknown): { status: number; result: SpeechTranscriptionResult } {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return {
      status: 413,
      result: {
        ok: false,
        error: {
          code: "unsupported_audio",
          message: `Audio upload exceeds the ${Math.floor(MAX_SPEECH_AUDIO_BYTES / 1024 / 1024)}MB limit.`,
          retryable: false,
        },
      },
    };
  }
  return {
    status: 400,
    result: {
      ok: false,
      error: {
        code: "unsupported_audio",
        message: "Invalid multipart audio upload.",
        retryable: false,
      },
    },
  };
}

export function registerSpeechRoutes(app: Express, deps: SpeechRouteDependencies): void {
  app.post("/api/speech/transcriptions", asyncRoute(async (req, res) => {
    try {
      await uploadSingleAudio(req, res);
    } catch (error) {
      const mapped = uploadErrorResult(error);
      res.status(mapped.status).json(mapped.result);
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({
        ok: false,
        error: {
          code: "unsupported_audio",
          message: "Upload exactly one audio file in the `audio` field.",
          retryable: false,
        },
      } satisfies SpeechTranscriptionResult);
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const metadataDuration = parseOptionalDurationSeconds(body.durationSeconds);
    const durationSeconds = resolveKnownAudioDurationSeconds({
      buffer: file.buffer,
      mimeType: file.mimetype,
      metadataDurationSeconds: metadataDuration,
    });
    const maxAudioSeconds = parseOptionalDurationSeconds(body.maxAudioSeconds);
    const routeAudioError = validateSpeechAudio({
      audioBytes: file.size,
      mimeType: file.mimetype,
      durationSeconds,
      maxAudioSeconds: maxAudioSeconds ?? Number.MAX_SAFE_INTEGER,
    });
    if (routeAudioError) {
      const result: SpeechTranscriptionResult = {
        ok: false,
        error: {
          code: routeAudioError.code,
          message: routeAudioError.message,
          retryable: false,
        },
      };
      res.status(resultStatus(result)).json(result);
      return;
    }

    const result = await deps.speechTranscriptionService.transcribe({
      audio: file.buffer,
      fileName: file.originalname,
      metadata: buildSpeechRequestMetadata({
        body,
        mimeType: file.mimetype,
        audioBytes: file.size,
        durationSeconds,
      }),
    });

    res.status(resultStatus(result)).json(result);
  }));

  if (deps.speechModelManager) {
    app.get("/api/speech/models", asyncRoute(async (_req, res) => {
      res.json(await deps.speechModelManager!.listModels());
    }));

    app.post("/api/speech/models/:modelId/download", asyncRoute(async (req, res) => {
      const modelId = String(req.params.modelId || "");
      const acceptedLicenseId = typeof req.body?.acceptedLicenseId === "string" ? req.body.acceptedLicenseId : undefined;
      if (!deps.speechModelManager!.hasModel(modelId)) {
        res.status(400).json({ error: `Unknown speech model: ${modelId}` });
        return;
      }
      try {
        // Validate acceptance synchronously before returning a background status.
        deps.speechModelManager!.validateDownloadAcceptance(modelId, acceptedLicenseId);
        const download = deps.speechModelManager!.downloadModel(modelId, acceptedLicenseId);
        download.catch(() => undefined);
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : "Model license acceptance is required." });
        return;
      }
      res.json({ status: "downloading", modelId });
    }));

    app.post("/api/speech/models/:modelId/cancel", asyncRoute(async (req, res) => {
      const modelId = String(req.params.modelId || "");
      deps.speechModelManager!.cancelDownload(modelId);
      res.json({ status: "cancelled", modelId });
    }));

    app.delete("/api/speech/models/:modelId", asyncRoute(async (req, res) => {
      const modelId = String(req.params.modelId || "");
      await deps.speechModelManager!.deleteModel(modelId);
      res.status(204).send();
    }));
  }

  if (deps.speechSynthesisService) {
    app.post("/api/speech/synthesis", asyncRoute(async (req, res) => {
      const body = req.body as { text?: unknown; projectId?: unknown; sprintId?: unknown; voice?: unknown };
      const result = await deps.speechSynthesisService!.synthesize({
        text: typeof body.text === "string" ? body.text : "",
        projectId: typeof body.projectId === "string" ? body.projectId : null,
        sprintId: typeof body.sprintId === "string" ? body.sprintId : null,
        voice: typeof body.voice === "string" ? body.voice : null,
      });
      if (!result.ok) {
        res.status(result.error.code === "permission_denied" ? 403 : result.error.code === "client_error" ? 400 : 503).json(result);
        return;
      }
      res.setHeader("Content-Type", result.contentType);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Codeux-Speech-Provider", result.provider);
      res.setHeader("X-Codeux-Speech-Model", result.model);
      res.send(result.audio);
    }));
  }
}
