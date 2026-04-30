/**
 * @vitest-environment jsdom
 */
import { h } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, act } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);

// Mock gsap for components potentially using it
vi.mock("gsap", () => ({
  default: {
    to: vi.fn(),
    fromTo: vi.fn(),
    set: vi.fn(),
    killTweensOf: vi.fn(),
    context: vi.fn((cb) => {
      cb();
      return { revert: vi.fn() };
    })
  }
}));

import { Button } from "../../ui/Button.js";

afterEach(() => {
  cleanup();
});

describe("Async Feedback Interactions", () => {
  it("shows pending state on click, resolves to success, and resets after timeout", async () => {
    vi.useFakeTimers();

    let resolvePromise: () => void;
    const asyncAction = vi.fn().mockImplementation(() => {
      return new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });
    });

    const { getByRole, container } = render(
      <Button onClick={asyncAction}>
        Async Action
      </Button>
    );

    const button = getByRole("button");

    // Initial state
    expect(button).not.toBeDisabled();

    // userEvent might hang with fake timers if we aren't careful, let's use advanceTimers by using fireEvent or configuring userEvent
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(button);
    expect(asyncAction).toHaveBeenCalledTimes(1);

    // Should enter pending state
    expect(button).toBeDisabled();
    // Verify loader is rendered. Loader2 from lucide has animate-spin
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();

    // Resolve the promise
    await act(async () => {
      resolvePromise();
    });

    // Should enter success state (loader gone, button still disabled per internal state transition before dismiss)
    // The success state removes animate-spin, and sets `isSuccess` true overriding colors.
    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();

    // In our implementation Button disables on pending OR feedback.status !== idle
    // we use "isPending" for disabled which checks feedback.status === "pending"
    // Wait, let's just check the class.
    expect(button.className).toMatch(/!bg-status-green/);

    // Fast forward time to let auto dismiss reset the state
    await act(async () => {
      vi.advanceTimersByTime(2000); // 1500 is default dismiss for Button
    });

    // Should be back to normal
    expect(button).not.toBeDisabled();
    expect(button.className).not.toMatch(/!bg-status-green/);

    vi.useRealTimers();
  });

  it("shows error state on rejection", async () => {
    vi.useFakeTimers();

    // In Preact, unhandled promise rejections during click handlers often bubble to window.
    // We suppress the console.error/unhandled rejection just for this test so it passes cleanly.
    const originalError = console.error;
    console.error = vi.fn();

    // A better approach for testing useActionFeedback is to decouple it from Button's throw behavior,
    // or we mock the global `Promise.reject` to silence it but that is bad practice.
    // Given vitest complains heavily about unhandled rejections that escape the test lifecycle,
    // we can rewrite this test to use `renderHook` or just test the component that doesn't rethrow,
    // OR we can make Button not crash Vitest by providing an onClick that doesn't return a pure promise.
    // Wait, the Button only enters `isError` if the promise rejects!
    // To suppress vitest unhandled rejection globally we can use an empty catch block on process.
    // Vitest intercepts unhandled errors globally using `process.on('unhandledRejection')` from its own runner.
    // Since removing listeners didn't work (vitest might re-add them), we can use a custom Promise implementation for this mock.
    const asyncAction = vi.fn().mockImplementation(() => {
        const p = Promise.reject(new Error("Expected Rejection For Test"));
        p.catch(() => {}); // prevent unhandled rejection warning

        // Button uses `typeof result.then === "function"`.
        // If we provide a thenable that catches its own errors internally but passes the reject handler down,
        // we can trigger the Button's catch without leaking the throw.
        return {
            then: (onFulfilled: any) => {
                // Button does: `result.then(() => setSuccess("")).catch((err) => { setError(""); throw err; })`
                // Let's simulate the `.catch` directly here without returning a real promise that throws.
                return {
                    catch: (onRejected: any) => {
                        // Immediately invoke the rejected handler to set the error state
                        try {
                            onRejected(new Error("Expected Rejection For Test"));
                        } catch (e) {
                            // Suppress the throw from the Button component's catch block!
                        }
                    }
                };
            }
        };
    });

    const { getByRole } = render(
      <Button onClick={asyncAction}>
        Async Action Error
      </Button>
    );

    const button = getByRole("button");

    await act(async () => {
        button.click();
    });

    await act(async () => {
       vi.runAllTimers();
    });

    // After rejection, state should be error
    expect(button.className).toMatch(/!bg-status-red/);

    console.error = originalError;
    vi.useRealTimers();
  });
});