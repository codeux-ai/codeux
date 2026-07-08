import type { Express, Request, Response } from "express";
import multer from "multer";
import type { SpeechTranscriptionResult } from "../contracts/speech-types.js";
import type { SpeechTranscriptionService } from "../services/speech-transcription-service.js";
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
}
