import { useCallback } from "preact/hooks";
import { useActionFeedback, type ActionFeedbackState, type ActionFeedbackStatus } from "./use-action-feedback.js";
import { getUserFriendlyErrorMessage } from "../lib/errors/user-message.js";

export interface AsyncActionOptions<T> {
  onSuccess?: (data: T) => void;
  onError?: (error: unknown) => void;
  successMessage?: string | ((data: T) => string);
  errorMessage?: string;
  pendingMessage?: string;
}

export function useAsyncAction<T, Args extends any[]>(
  action: (...args: Args) => Promise<T>,
  options?: AsyncActionOptions<T>
) {
  const { feedback, setPending, setSuccess, setError, clearFeedback } = useActionFeedback();

  const execute = useCallback(
    async (...args: Args): Promise<T | undefined> => {
      setPending(options?.pendingMessage || "Processing...");

      try {
        const result = await action(...args);

        const successMsg =
          typeof options?.successMessage === "function"
            ? options.successMessage(result)
            : options?.successMessage || "Action completed successfully.";

        setSuccess(successMsg);

        if (options?.onSuccess) {
          options.onSuccess(result);
        }

        return result;
      } catch (err) {
        const mappedMessage = getUserFriendlyErrorMessage(err, options?.errorMessage || "Action failed.");
        setError(mappedMessage);

        if (options?.onError) {
          options.onError(err);
        }

        return undefined;
      }
    },
    [action, options, setPending, setSuccess, setError]
  );

  return {
    execute,
    feedback,
    isPending: feedback.status === "pending",
    reset: clearFeedback,
  };
}
