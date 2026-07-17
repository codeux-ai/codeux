import type { JSX, RefObject } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ChatMessageRecord } from "../../types.js";
import type { DashboardLocale } from "../../i18n/locales.js";
import { translateChatMessage, translateChatPlural } from "../../i18n/messages/chat.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";

export type ComposerStatusTone = "disabled" | "ready" | "sending" | "queued" | "sent" | "failed";

export interface ComposerStatusViewModel {
  tone: ComposerStatusTone;
  visibleText: string;
  liveText: string;
  disabledReason: string | null;
}

export const CHAT_COMPOSER_HELP_ID = "composer-help";
export const CHAT_COMPOSER_STATUS_ID = "composer-status";
export const CHAT_COMPOSER_DESCRIBED_BY = `${CHAT_COMPOSER_HELP_ID} ${CHAT_COMPOSER_STATUS_ID}`;

export const COMPOSER_STATUS_TONE_CLASS: Record<ComposerStatusTone, string> = {
  disabled: "border-black/[0.06] bg-black/[0.025] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.025] dark:text-slate-400",
  ready: "border-signal-500/20 bg-signal-500/[0.08] text-signal-700 dark:text-signal-300",
  sending: "border-signal-500/25 bg-signal-500/[0.10] text-signal-700 dark:text-signal-300",
  queued: "border-status-amber/25 bg-status-amber/[0.10] text-status-amber",
  sent: "border-signal-500/20 bg-signal-500/[0.08] text-signal-700 dark:text-signal-300",
  failed: "border-status-red/25 bg-status-red/[0.08] text-status-red",
};

export const getLatestDashboardMessage = (messages: readonly ChatMessageRecord[]): ChatMessageRecord | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.direction === "dashboard_to_connection") {
      return message;
    }
  }
  return null;
};

export const buildComposerStatus = (input: {
  activeConnectionName: string | null;
  error: string | null;
  latestDashboardMessage: ChatMessageRecord | null;
  pendingDashboardMessages: number;
  selectedProject: boolean;
  sending: boolean;
  speechError: string | null;
  trimmedInput: string;
  locale?: DashboardLocale;
}): ComposerStatusViewModel => {
  const locale = input.locale ?? "en";
  const disabledReason = !input.selectedProject
    ? translateChatMessage(locale, "selectProjectBeforeSending")
    : input.sending
      ? translateChatMessage(locale, "messageAlreadySending")
      : !input.trimmedInput
        ? translateChatMessage(locale, "writeMessageBeforeSending")
        : null;

  if (!input.selectedProject) {
    const noProjectReason = translateChatMessage(locale, "selectProjectBeforeSending");
    return { tone: "disabled", visibleText: noProjectReason, liveText: noProjectReason, disabledReason };
  }

  if (input.sending) {
    return {
      tone: "sending",
      visibleText: translateChatMessage(locale, "sendingMessageToCodeUx"),
      liveText: translateChatMessage(locale, "sendingMessage"),
      disabledReason,
    };
  }

  if (input.error) {
    return {
      tone: "failed",
      visibleText: translateChatMessage(locale, "sendFailedDraftPreserved", { error: input.error }),
      liveText: translateChatMessage(locale, "failedWithError", { error: input.error }),
      disabledReason,
    };
  }

  if (input.speechError) {
    return {
      tone: "failed",
      visibleText: translateChatMessage(locale, "voicePlaybackFailedWithTranscript", { error: input.speechError }),
      liveText: translateChatMessage(locale, "voicePlaybackFailed", { error: input.speechError }),
      disabledReason,
    };
  }

  if (input.pendingDashboardMessages > 0) {
    const queuedLabel = translateChatPlural(locale, "queuedForDelivery", input.pendingDashboardMessages, {
      count: new Intl.NumberFormat(locale).format(input.pendingDashboardMessages),
    });
    return {
      tone: "queued",
      visibleText: translateChatMessage(locale, "workerWillClaimTurn", { queued: queuedLabel }),
      liveText: queuedLabel,
      disabledReason,
    };
  }

  if (input.latestDashboardMessage?.deliveryStatus === "failed") {
    return {
      tone: "failed",
      visibleText: translateChatMessage(locale, "latestMessageFailed"),
      liveText: translateChatMessage(locale, "latestMessageFailedLive"),
      disabledReason,
    };
  }

  if (input.latestDashboardMessage?.deliveryStatus === "pending") {
    return {
      tone: "queued",
      visibleText: translateChatMessage(locale, "latestMessageQueued"),
      liveText: translateChatMessage(locale, "latestMessageQueuedLive"),
      disabledReason,
    };
  }

  if (input.latestDashboardMessage?.deliveryStatus === "delivered") {
    return {
      tone: "sent",
      visibleText: translateChatMessage(locale, "messageSentWaiting"),
      liveText: translateChatMessage(locale, "messageSent"),
      disabledReason,
    };
  }

  if (input.latestDashboardMessage?.deliveryStatus === "processed") {
    return {
      tone: "sent",
      visibleText: translateChatMessage(locale, "latestMessageProcessed"),
      liveText: translateChatMessage(locale, "latestMessageProcessedLive"),
      disabledReason,
    };
  }

  if (input.trimmedInput) {
    const target = input.activeConnectionName
      ? locale === "de" ? ` an ${input.activeConnectionName}` : ` to ${input.activeConnectionName}`
      : "";
    return {
      tone: "ready",
      visibleText: translateChatMessage(locale, "readyToSend", { target }),
      liveText: translateChatMessage(locale, "composerReady"),
      disabledReason,
    };
  }

  return {
    tone: "disabled",
    visibleText: translateChatMessage(locale, "writeToEnableSend"),
    liveText: translateChatMessage(locale, "composerDisabled"),
    disabledReason,
  };
};

const getTranscriptJoiner = (before: string, after: string): string => {
  if (!before || !after) return "";
  return /\s$/.test(before) || /^\s/.test(after) ? "" : " ";
};

interface ComposerSelection {
  start: number;
  end: number;
}

interface ComposerAttempt {
  contextKey: string;
  text: string;
  kind: "composer" | "action";
  selection: ComposerSelection | null;
  execute: () => Promise<void>;
}

export interface ChatComposerControls {
  asyncFeedbackStyle: JSX.CSSProperties;
  composerRef: RefObject<HTMLTextAreaElement>;
  controlFeedbackStyle: JSX.CSSProperties;
  describedBy: string;
  error: string | null;
  handleInput: (element: HTMLTextAreaElement) => void;
  handleKeyDown: (event: JSX.TargetedKeyboardEvent<HTMLTextAreaElement>) => void;
  input: string;
  insertSpeechTranscript: (transcript: string) => void;
  pending: boolean;
  quickActionsDisabled: boolean;
  rememberSelection: (element: HTMLTextAreaElement) => void;
  retry: () => Promise<void>;
  retryAvailable: boolean;
  retryButtonLabel: string;
  sendButtonLabel: string;
  sendDisabled: boolean;
  speechDisabled: boolean;
  status: ComposerStatusViewModel;
  statusLive: "assertive" | "polite";
  statusRole: "alert" | "status";
  submit: () => Promise<void>;
  submitAction: (text: string, execute?: () => Promise<void>) => Promise<void>;
}

export const useChatComposerControls = (options: {
  activeConnectionName: string | null;
  composerRef: RefObject<HTMLTextAreaElement>;
  contextKey: string;
  error: string | null;
  input: string;
  latestDashboardMessage: ChatMessageRecord | null;
  locale: DashboardLocale;
  navigateHistory: (direction: "up" | "down") => boolean;
  pendingDashboardMessages: number;
  selectedProject: boolean;
  sending: boolean;
  setInput: (value: string) => void;
  speechError: string | null;
  onSend: (overrideText?: string) => Promise<void>;
}): ChatComposerControls => {
  const interactionTokens = useInteractionTokens();
  const [localPending, setLocalPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [failedAttempt, setFailedAttempt] = useState<ComposerAttempt | null>(null);
  const pendingRef = useRef(false);
  const contextKeyRef = useRef(options.contextKey);
  const inputRef = useRef(options.input);
  const externalErrorRef = useRef(options.error);
  const selectionByContextRef = useRef(new Map<string, ComposerSelection>());
  const previousContextRef = useRef(options.contextKey);

  contextKeyRef.current = options.contextKey;
  inputRef.current = options.input;
  externalErrorRef.current = options.error;

  const effectivePending = options.sending || localPending;
  const effectiveError = localError ?? options.error;
  const status = useMemo(() => buildComposerStatus({
    activeConnectionName: options.activeConnectionName,
    error: effectiveError,
    latestDashboardMessage: options.latestDashboardMessage,
    pendingDashboardMessages: options.pendingDashboardMessages,
    selectedProject: options.selectedProject,
    sending: effectivePending,
    speechError: options.speechError,
    trimmedInput: options.input.trim(),
    locale: options.locale,
  }), [
    effectiveError,
    effectivePending,
    options.activeConnectionName,
    options.input,
    options.latestDashboardMessage,
    options.locale,
    options.pendingDashboardMessages,
    options.selectedProject,
    options.speechError,
  ]);

  const rememberSelection = useCallback((element: HTMLTextAreaElement): void => {
    selectionByContextRef.current.set(contextKeyRef.current, {
      start: element.selectionStart,
      end: element.selectionEnd,
    });
  }, []);

  const focusComposer = useCallback((selection?: ComposerSelection | null): void => {
    requestAnimationFrame(() => {
      const composer = options.composerRef.current;
      if (!composer) return;
      composer.focus({ preventScroll: true });
      composer.style.height = "auto";
      composer.style.height = `${composer.scrollHeight}px`;
      const fallback = composer.value.length;
      const start = Math.min(selection?.start ?? fallback, fallback);
      const end = Math.min(selection?.end ?? start, fallback);
      composer.setSelectionRange(start, end);
      selectionByContextRef.current.set(contextKeyRef.current, { start, end });
    });
  }, [options.composerRef]);

  useEffect(() => {
    if (previousContextRef.current === options.contextKey) return;
    previousContextRef.current = options.contextKey;
    pendingRef.current = false;
    setLocalPending(false);
    setLocalError(null);
    setFailedAttempt(null);
    focusComposer(selectionByContextRef.current.get(options.contextKey) ?? null);
  }, [focusComposer, options.contextKey, options.input]);

  const handleInput = useCallback((element: HTMLTextAreaElement): void => {
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
    rememberSelection(element);
    setFailedAttempt(null);
    options.setInput(element.value);
  }, [options.setInput, rememberSelection]);

  const runAttempt = useCallback(async (attempt: ComposerAttempt, retrying: boolean): Promise<void> => {
    if (pendingRef.current || options.sending || !options.selectedProject || contextKeyRef.current !== attempt.contextKey) {
      return;
    }
    pendingRef.current = true;
    setLocalPending(true);
    setLocalError(null);
    setFailedAttempt(attempt);
    let caughtError: string | null = null;
    try {
      await attempt.execute();
    } catch (sendError) {
      caughtError = sendError instanceof Error ? sendError.message : String(sendError);
      setLocalError(caughtError);
    } finally {
      pendingRef.current = false;
      setLocalPending(false);
      requestAnimationFrame(() => {
        if (contextKeyRef.current !== attempt.contextKey) {
          return;
        }
        const failed = Boolean(externalErrorRef.current || caughtError);
        if (!failed) {
          setFailedAttempt(null);
          if (retrying && attempt.kind === "composer" && inputRef.current === attempt.text) {
            options.setInput("");
          }
        } else if (attempt.kind === "composer" && !inputRef.current) {
          options.setInput(attempt.text);
        }
        focusComposer(failed ? attempt.selection : null);
      });
    }
  }, [focusComposer, options.selectedProject, options.sending, options.setInput]);

  const submit = useCallback(async (): Promise<void> => {
    const text = inputRef.current.trim();
    if (!text || status.disabledReason || pendingRef.current) return;
    const selection = selectionByContextRef.current.get(contextKeyRef.current) ?? null;
    await runAttempt({
      contextKey: contextKeyRef.current,
      text,
      kind: "composer",
      selection,
      execute: () => options.onSend(),
    }, false);
  }, [options.onSend, runAttempt, status.disabledReason]);

  const submitAction = useCallback(async (text: string, execute?: () => Promise<void>): Promise<void> => {
    const normalizedText = text.trim();
    if (!normalizedText || effectivePending || !options.selectedProject || pendingRef.current) return;
    await runAttempt({
      contextKey: contextKeyRef.current,
      text: normalizedText,
      kind: "action",
      selection: selectionByContextRef.current.get(contextKeyRef.current) ?? null,
      execute: execute ?? (() => options.onSend(normalizedText)),
    }, false);
  }, [effectivePending, options.onSend, options.selectedProject, runAttempt]);

  const latestFailedMessage = options.latestDashboardMessage?.deliveryStatus === "failed"
    ? options.latestDashboardMessage
    : null;
  const retryAttempt = failedAttempt?.contextKey === options.contextKey
    ? failedAttempt
    : latestFailedMessage
      ? {
          contextKey: options.contextKey,
          text: latestFailedMessage.bodyMarkdown,
          kind: "action" as const,
          selection: null,
          execute: () => options.onSend(latestFailedMessage.bodyMarkdown),
        }
      : null;
  const retryAvailable = Boolean(retryAttempt && (effectiveError || latestFailedMessage));
  const retry = useCallback(async (): Promise<void> => {
    if (!retryAttempt || retryAttempt.contextKey !== contextKeyRef.current) return;
    await runAttempt(retryAttempt, true);
  }, [retryAttempt, runAttempt]);

  const insertSpeechTranscript = useCallback((transcript: string): void => {
    const trimmedTranscript = transcript.trim();
    if (!trimmedTranscript) return;
    const composer = options.composerRef.current;
    const sourceValue = composer?.value ?? inputRef.current;
    const remembered = selectionByContextRef.current.get(contextKeyRef.current);
    const selection = remembered
      && remembered.start >= 0
      && remembered.end >= remembered.start
      && remembered.end <= sourceValue.length
      ? remembered
      : { start: sourceValue.length, end: sourceValue.length };
    const before = sourceValue.slice(0, selection.start);
    const after = sourceValue.slice(selection.end);
    const insert = `${getTranscriptJoiner(before, trimmedTranscript)}${trimmedTranscript}${getTranscriptJoiner(trimmedTranscript, after)}`;
    const nextValue = `${before}${insert}${after}`;
    const nextCaret = before.length + insert.length;
    setFailedAttempt(null);
    options.setInput(nextValue);
    focusComposer({ start: nextCaret, end: nextCaret });
  }, [focusComposer, options.composerRef, options.setInput]);

  const handleKeyDown = useCallback((event: JSX.TargetedKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const element = event.currentTarget;
    const isSingleLine = !element.value.includes("\n");
    const atStart = element.selectionStart === 0 && element.selectionEnd === 0;
    const atEnd = element.selectionStart === element.value.length && element.selectionEnd === element.value.length;
    const direction = event.key === "ArrowUp" ? "up" : "down";
    const shouldRecall = direction === "up" ? (isSingleLine || atStart) : (isSingleLine || atEnd);
    if (!shouldRecall || !options.navigateHistory(direction)) return;
    event.preventDefault();
    requestAnimationFrame(() => {
      const nextComposer = options.composerRef.current;
      if (!nextComposer) return;
      nextComposer.style.height = "auto";
      nextComposer.style.height = `${nextComposer.scrollHeight}px`;
      const position = direction === "up" ? 0 : nextComposer.value.length;
      nextComposer.setSelectionRange(position, position);
      rememberSelection(nextComposer);
    });
  }, [options.composerRef, options.navigateHistory, rememberSelection, submit]);

  const sendDisabled = Boolean(status.disabledReason) || effectivePending;
  const sendButtonLabel = effectivePending
    ? translateChatMessage(options.locale, "sendingMessageLabel")
    : status.disabledReason
      ? translateChatMessage(options.locale, "sendMessageUnavailable", { reason: status.disabledReason })
      : translateChatMessage(options.locale, "sendMessage");

  return {
    asyncFeedbackStyle: {
      transitionDuration: interactionTokens.asyncFeedback.duration,
      transitionTimingFunction: interactionTokens.asyncFeedback.ease,
    },
    composerRef: options.composerRef,
    controlFeedbackStyle: {
      transitionDuration: interactionTokens.controlFeedback.duration,
      transitionTimingFunction: interactionTokens.controlFeedback.ease,
    },
    describedBy: CHAT_COMPOSER_DESCRIBED_BY,
    error: effectiveError,
    handleInput,
    handleKeyDown,
    input: options.input,
    insertSpeechTranscript,
    pending: effectivePending,
    quickActionsDisabled: effectivePending || !options.selectedProject,
    rememberSelection,
    retry,
    retryAvailable,
    retryButtonLabel: effectivePending
      ? translateChatMessage(options.locale, "retryingFailedMessage")
      : translateChatMessage(options.locale, "retryFailedMessage"),
    sendButtonLabel,
    sendDisabled,
    speechDisabled: effectivePending || !options.selectedProject,
    status,
    statusLive: status.tone === "failed" ? "assertive" : "polite",
    statusRole: status.tone === "failed" ? "alert" : "status",
    submit,
    submitAction,
  };
};
