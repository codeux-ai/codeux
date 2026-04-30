1. **Create `dashboard/src/v2/lib/errors/user-message.ts`**:
   - Use `write_file` to create the function `getUserFriendlyErrorMessage(error: unknown, fallbackMessage: string = "An unexpected error occurred"): string`.
   - The implementation will check if `error` is an instance of `Error` and return `error.message` ONLY if it doesn't look like a raw JSON payload (e.g. by checking if it contains `{` or `[`). If it does, return `fallbackMessage`. If `error` is a string, do similar checks. Otherwise, return `fallbackMessage`.
   - Run `read_file` to verify the content.

2. **Create `dashboard/src/v2/hooks/use-async-action.ts`**:
   - Use `write_file` to create `dashboard/src/v2/hooks/use-async-action.ts`.
   - Provide the hook: `export function useAsyncAction<T, Args extends any[]>(action: (...args: Args) => Promise<T>, options?: { onSuccess?: (data: T) => void, onError?: (error: unknown) => void, successMessage?: string | ((data: T) => string), errorMessage?: string, pendingMessage?: string })`
   - It will internally use `const { feedback, setPending, setSuccess, setError, clearFeedback } = useActionFeedback();`
   - It will export `execute: (...args: Args) => Promise<T | undefined>`, `status: ActionFeedbackStatus` (from `feedback.status`), `error: unknown`, `isPending: boolean` (status === "pending"), `reset: () => void`.
   - Inside `execute`, it will call `setPending(options.pendingMessage || "Processing...")`, then await the action.
   - On success, `setSuccess(successMsg)`, call `onSuccess`, and return data.
   - On catch, map the error using `getUserFriendlyErrorMessage(err, options.errorMessage)`, call `setError(mappedMessage)`, call `onError`, and return `undefined`.
   - Run `read_file` to verify the content.

3. **Create `dashboard/src/v2/components/ui/Toast.tsx`**:
   - Use `write_file` to implement `ToastProvider` and `useToast` via a Preact Context `ToastContext`.
   - The Context type: `{ toast: (options: ToastOptions) => void }` where `ToastOptions` is `{ status: ActionFeedbackStatus, message: string, duration?: number }`.
   - The provider manages an array of toasts state: `const [toasts, setToasts] = useState<(ToastOptions & { id: string })[]>([])`.
   - The `toast` function appends a toast with a unique ID and sets a timeout to remove it based on `duration` (default 5000ms).
   - Render the `toasts` array mapped into `<ActionFeedbackRegion status={t.status} message={t.message} onDismiss={() => removeToast(t.id)} autoDismissMs={t.duration} />` components, inside a fixed container `<div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">`.
   - Run `read_file` to verify the content.

4. **Create `dashboard/src/v2/components/ui/AsyncState.tsx`**:
   - Use `write_file` to create an `AsyncState` component.
   - Interface: `interface AsyncStateProps { status: ActionFeedbackStatus; message: string | null; children?: preact.ComponentChildren; onRetry?: () => void; retryLabel?: string; }`.
   - Logic:
     - If `status === "idle" || status === "success"`, return `<>{children}</>`.
     - If `status === "pending" || status === "error" || status === "warning"`, return `<ActionFeedbackRegion status={status} message={message} retryAction={onRetry} retryLabel={retryLabel} autoDismiss={false} />`.
   - Run `read_file` to verify the content.

5. **Run Validation Suite**:
   - Run `pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run test:coverage && pnpm run build`.

6. **Run Pre-commit Step**:
   - Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.

7. **Submit Code**:
   - Commit and submit.
