/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSpeechPlayback } from "../use-speech-playback.js";

const speechApiMock = vi.hoisted(() => ({
  synthesizeSpeech: vi.fn(),
}));

vi.mock("../../lib/speech-api.js", () => ({
  synthesizeSpeech: speechApiMock.synthesizeSpeech,
}));

vi.mock("../../lib/speech-playback.js", () => ({
  speechTextFromMarkdown: (markdown: string) => markdown,
  splitSpeechPlaybackText: (text: string) => text.split(" | ").filter(Boolean),
}));

interface Deferred<T> {
  promise: Promise<T>;
  reject: (error: unknown) => void;
  resolve: (value: T) => void;
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

class FakeAudio {
  static instances: FakeAudio[] = [];

  readonly onPause = vi.fn();
  readonly onPlay = vi.fn(() => Promise.resolve());
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly src: string) {
    FakeAudio.instances.push(this);
  }

  pause(): void {
    this.onPause();
  }

  play(): Promise<void> {
    return this.onPlay();
  }

  end(): void {
    this.onended?.();
  }

  fail(): void {
    this.onerror?.();
  }
}

const blobLabels = new WeakMap<Blob, string>();
const speechBlob = (label: string): Blob => {
  const blob = new Blob([label], { type: "audio/wav" });
  blobLabels.set(blob, label);
  return blob;
};

const request = (markdown: string, messageId = "message-1") => ({
  markdown,
  messageId,
  projectId: "project-1",
});

describe("useSpeechPlayback", () => {
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    FakeAudio.instances = [];
    speechApiMock.synthesizeSpeech.mockReset();
    revokeObjectURL.mockReset();
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn((blob: Blob) => `blob:${blobLabels.get(blob) ?? "unknown"}`),
      revokeObjectURL,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("starts the first sentence alone, then overlaps a bounded lookahead with playback", async () => {
    const chunks = [deferred<Blob>(), deferred<Blob>(), deferred<Blob>(), deferred<Blob>()];
    speechApiMock.synthesizeSpeech.mockImplementation((text: string) => {
      const index = ["first", "second", "third", "fourth"].indexOf(text);
      return chunks[index].promise;
    });
    const { result } = renderHook(() => useSpeechPlayback());

    act(() => {
      void result.current.play(request("first | second | third | fourth"));
    });

    expect(speechApiMock.synthesizeSpeech).toHaveBeenCalledTimes(1);
    expect(speechApiMock.synthesizeSpeech).toHaveBeenNthCalledWith(
      1,
      "first",
      "project-1",
      undefined,
      expect.any(AbortSignal),
    );

    await act(async () => {
      chunks[0].resolve(speechBlob("first"));
      await chunks[0].promise;
    });

    expect(FakeAudio.instances.map((audio) => audio.src)).toEqual(["blob:first"]);
    expect(FakeAudio.instances[0].onPlay).toHaveBeenCalledTimes(1);
    expect(speechApiMock.synthesizeSpeech.mock.calls.map(([text]) => text)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("stores out-of-order synthesis results but plays every chunk in strict order", async () => {
    const chunks = [deferred<Blob>(), deferred<Blob>(), deferred<Blob>(), deferred<Blob>()];
    speechApiMock.synthesizeSpeech.mockImplementation((text: string) => (
      chunks[["first", "second", "third", "fourth"].indexOf(text)].promise
    ));
    const { result } = renderHook(() => useSpeechPlayback());
    let playback!: Promise<void>;

    act(() => {
      playback = result.current.play(request("first | second | third | fourth"));
    });
    await act(async () => {
      chunks[0].resolve(speechBlob("first"));
      await chunks[0].promise;
    });
    await act(async () => {
      chunks[2].resolve(speechBlob("third"));
      await chunks[2].promise;
      FakeAudio.instances[0].end();
      await Promise.resolve();
    });
    expect(FakeAudio.instances.map((audio) => audio.src)).toEqual(["blob:first"]);

    await act(async () => {
      chunks[1].resolve(speechBlob("second"));
      await chunks[1].promise;
    });
    expect(FakeAudio.instances.map((audio) => audio.src)).toEqual(["blob:first", "blob:second"]);
    expect(speechApiMock.synthesizeSpeech.mock.calls.map(([text]) => text)).toEqual([
      "first",
      "second",
      "third",
      "fourth",
    ]);

    await act(async () => {
      chunks[3].resolve(speechBlob("fourth"));
      await chunks[3].promise;
      FakeAudio.instances[1].end();
      await Promise.resolve();
    });
    expect(FakeAudio.instances.map((audio) => audio.src)).toEqual([
      "blob:first",
      "blob:second",
      "blob:third",
    ]);

    await act(async () => {
      FakeAudio.instances[2].end();
      await Promise.resolve();
    });
    expect(FakeAudio.instances.map((audio) => audio.src)).toEqual([
      "blob:first",
      "blob:second",
      "blob:third",
      "blob:fourth",
    ]);
    await act(async () => {
      FakeAudio.instances[3].end();
      await playback;
    });

    expect(result.current.activeMessageId).toBeNull();
    expect(result.current.error).toBeNull();
    expect(revokeObjectURL.mock.calls.map(([url]) => url)).toEqual([
      "blob:first",
      "blob:second",
      "blob:third",
      "blob:fourth",
    ]);
  });

  it("aborts synthesis and releases the current audio when stopped or unmounted", async () => {
    const first = deferred<Blob>();
    const later = [deferred<Blob>(), deferred<Blob>()];
    const unmountSynthesis = deferred<Blob>();
    speechApiMock.synthesizeSpeech
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(later[0].promise)
      .mockReturnValueOnce(later[1].promise)
      .mockReturnValueOnce(unmountSynthesis.promise);
    const { result, unmount } = renderHook(() => useSpeechPlayback());
    let playback!: Promise<void>;

    act(() => {
      playback = result.current.play(request("first | second | third"));
    });
    await act(async () => {
      first.resolve(speechBlob("first"));
      await first.promise;
    });
    const signals = speechApiMock.synthesizeSpeech.mock.calls.map((call) => call[3] as AbortSignal);

    act(() => result.current.stop());
    await playback;

    expect(signals).toHaveLength(3);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(FakeAudio.instances[0].onPause).toHaveBeenCalledTimes(1);
    expect(FakeAudio.instances[0].onended).toBeNull();
    expect(FakeAudio.instances[0].onerror).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first");
    expect(result.current.activeMessageId).toBeNull();

    act(() => {
      void result.current.play(request("unmount", "message-2"));
    });
    const unmountSignal = speechApiMock.synthesizeSpeech.mock.calls.at(-1)?.[3] as AbortSignal;
    unmount();
    expect(unmountSignal.aborted).toBe(true);
  });

  it("suppresses late synthesis from a replaced run", async () => {
    const oldSynthesis = deferred<Blob>();
    const replacementSynthesis = deferred<Blob>();
    speechApiMock.synthesizeSpeech
      .mockReturnValueOnce(oldSynthesis.promise)
      .mockReturnValueOnce(replacementSynthesis.promise);
    const { result } = renderHook(() => useSpeechPlayback());

    act(() => {
      void result.current.play(request("old", "old-message"));
      void result.current.play(request("replacement", "new-message"));
    });
    const oldSignal = speechApiMock.synthesizeSpeech.mock.calls[0][3] as AbortSignal;
    expect(oldSignal.aborted).toBe(true);

    await act(async () => {
      replacementSynthesis.resolve(speechBlob("replacement"));
      await replacementSynthesis.promise;
      oldSynthesis.resolve(speechBlob("old"));
      await oldSynthesis.promise;
    });

    expect(FakeAudio.instances.map((audio) => audio.src)).toEqual(["blob:replacement"]);
    expect(result.current.activeMessageId).toBe("new-message");
  });

  it("surfaces synthesis and browser playback errors and stops the run", async () => {
    const synthesisFailure = deferred<Blob>();
    speechApiMock.synthesizeSpeech.mockReturnValueOnce(synthesisFailure.promise);
    const { result } = renderHook(() => useSpeechPlayback());

    act(() => {
      void result.current.play(request("synthesis failure"));
    });
    await act(async () => {
      synthesisFailure.reject(new Error("Configured voice is unavailable."));
      await synthesisFailure.promise.catch(() => undefined);
    });
    await waitFor(() => expect(result.current.error).toBe("Configured voice is unavailable."));
    expect(result.current.activeMessageId).toBeNull();

    const playable = deferred<Blob>();
    speechApiMock.synthesizeSpeech.mockReturnValueOnce(playable.promise);
    act(() => {
      void result.current.play(request("playback failure", "message-2"));
    });
    await act(async () => {
      playable.resolve(speechBlob("playback failure"));
      await playable.promise;
    });
    act(() => FakeAudio.instances[0].fail());

    await waitFor(() => expect(result.current.error).toBe("The browser could not play the generated audio."));
    expect(result.current.activeMessageId).toBeNull();
    expect(FakeAudio.instances[0].onended).toBeNull();
    expect(FakeAudio.instances[0].onerror).toBeNull();
  });
});
