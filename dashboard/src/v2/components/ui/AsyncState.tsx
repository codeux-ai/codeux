import { h, Fragment } from "preact";
import type { ComponentChildren } from "preact";
import { ActionFeedbackRegion } from "./ActionFeedbackRegion.js";
import type { ActionFeedbackStatus } from "../../hooks/use-action-feedback.js";

export interface AsyncStateProps {
  status: ActionFeedbackStatus;
  message: string | null;
  children?: ComponentChildren;
  onRetry?: () => void;
  retryLabel?: string;
}

export function AsyncState({
  status,
  message,
  children,
  onRetry,
  retryLabel,
}: AsyncStateProps) {
  if (status === "idle" || status === "success") {
    return <Fragment>{children}</Fragment>;
  }

  return (
    <ActionFeedbackRegion
      status={status}
      message={message}
      retryAction={onRetry}
      retryLabel={retryLabel}
      autoDismiss={false}
    />
  );
}
