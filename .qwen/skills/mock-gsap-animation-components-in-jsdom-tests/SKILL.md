---
name: mock-gsap-animation-components-in-jsdom-tests
description: When a component uses GSAP delayedCall/timeline to gate downstream rendering, mock it in JSDOM tests so it fires callbacks immediately via queueMicrotask instead of depending on GSAP timers.
source: auto-skill
extracted_at: '2026-06-01T05:57:32.639Z'
---

# How to identify and fix GSAP timer-dependent tests hanging in JSDOM/CI

## When to use

A test renders a component that contains an animated child (e.g. intro/loading overlay) which uses **GSAP timers** (`gsap.delayedCall`, `gsap.to` with `delay`, `gsap.timeline` with `.call()`) to signal completion. In JSDOM, GSAP timers do not advance reliably, so:

- The animation's `onComplete` callback never fires
- Downstream rendering (gated by state that only changes after `onComplete`) never happens
- A `waitFor` assertion that waits for downstream behavior **hangs until timeout**

## Symptoms in CI logs

```
❯ runWithExpensiveErrorDiagnosticsDisabled .../@testing-library/dom/dist/wait-for.js:127
❯ Timeout.checkRealTimersCallback .../@testing-library/dom/dist/wait-for.js:121
```

The `waitFor` assertion never becomes true within the timeout because the component never reached the rendering stage the test is waiting for.

## Procedure

### 1. Identify the animation-gating component

Search for components that render an intro/animation/splash that gates the rest of the UI:

```bash
grep -r "gsap.delayedCall\|gsap.timeline\|onComplete\|onExitStart" <component-dir>/
```

Look for a component that:
- Receives `onComplete` (or similar) props
- Calls them inside `gsap.delayedCall(n, ...)` or `tl.call(...)` 
- Prevents downstream content (like the real UI or data-fetch hooks) from rendering until `onComplete` fires

### 2. Mock the component in the test file

Use `vi.mock()` **at the module level** (outside `describe`/`it` blocks) to replace the component with one that fires callbacks immediately:

```tsx
vi.mock("<relative-path-to-component>", () => ({
  <ComponentName>: ({ onExitStart, onComplete }: { onExitStart?: () => void; onComplete?: () => void }) => {
    queueMicrotask(() => onExitStart?.());
    queueMicrotask(() => onComplete?.());
    return null;
  },
}));
```

Key points:
- Use `queueMicrotask` (not `setTimeout(..., 0)`) — microtasks are guaranteed to flush before the next `waitFor` check cycle
- Fire both `onExitStart` and `onComplete` if both exist — the parent component may depend on both transitions
- Return `null` (no DOM output from the mock)
- The mock must be at the **top level** of the file — `vi.mock` is hoisted by Vitest before imports, ensuring it takes effect before the real component module is loaded

### 3. Verify the fix

Run the test:

```bash
pnpm vitest run <test-file> --reporter=verbose
```

The test should now complete in under ~100ms (vs potentially timing out at 1000ms+). Confirm the component's downstream behavior is reached and assertions pass.

## Why this works

- `vi.mock()` is hoisted by Vitest's transform pipeline above all `import` statements, so it intercepts the module before any component code references it
- `queueMicrotask` defers the callback just enough for React's rendering cycle to flush, but ensures it fires before any `waitFor` polling interval
- Returning `null` avoids rendering GSAP DOM nodes that would be irrelevant to the behavior under test

## Why `setTimeout(fn, 0)` is NOT recommended here

While `setTimeout(fn, 0)` also defers execution, Vitest's `fakeTimers` (if configured) may trap real timers — or CI environments may throttle `setTimeout` callbacks. `queueMicrotask` bypasses the timer queue entirely.

## Related: existing skill reference

For general CI debugging workflow (establish state, read workflow, cross-reference changes, run quality gates), see `ci-debugging-by-investigating-workflow-and-diff`.
