# Secondary Pages Design System

This document outlines the design system rules for the dashboard's secondary pages, including the Scheduler, Knowledge, File Browser, and Error pages.

## Page Structure

Secondary pages must follow a consistent structural wrapper to maintain standard visual continuity across the dashboard.

- **PageContainer Wrapper**: All secondary pages must be wrapped in a `PageContainer` component. This ensures unified padding, layout behavior, and responsive constraints.

## Knowledge interaction states

The Knowledge page keeps async work attached to the document or upload batch that started it. Apply
these rules when changing `/knowledge`:

- Destructive document removal uses the shared `ConfirmDialog`; native browser confirmation is not
  permitted. The dialog names the document, states that deletion is irreversible, supports Escape
  and cancel, remains pending through the DELETE request, and restores focus to its trigger when no
  deletion occurs.
- A confirmed deletion removes the document from client data immediately and leaves an in-place
  pending tombstone. If the request fails, restore the preserved document at its recorded index
  without refetching or replacing other client changes. If it succeeds, focus the next document,
  then the previous document, then the library heading, and announce the result. Successful server
  deletion has no undo unless a restoration API is available.
- Track delete and re-embed work by document ID. Disable only the affected row, suppress repeated
  requests, and keep pending, success, error, raw diagnostic, and retry feedback within that row.
- File selection and drag/drop share one upload path. Show accepted filenames while the request is
  pending, separate successful and failed files for partial results, retain failed `File` objects for
  an explicit retry, and do not hide existing document cards when a batch fails.
- Use the shared `asyncFeedback`, `enterExit`, and `listReorder` interaction contracts. Loading
  indicators include reduced-motion fallbacks; state and list updates occur without delayed motion
  when reduced motion is active.

## Watermark Headers

Secondary pages utilize a standard watermark header design pattern. This pattern establishes clear context without overwhelming the operational data on the page.

- **Background Watermark**: Implement a large, visually subdued background text element. This text should be decorative and explicitly hidden from screen readers using `aria-hidden="true"`.
- **Primary Heading**: Position a heavy `font-display` heading in front of the watermark. This heading acts as the primary title and context setter for the page.

### Example Implementation

```tsx
import { PageContainer } from '@/components/layout/PageContainer';

export function SecondaryPage() {
  return (
    <PageContainer>
      <div className="relative mb-8">
        <div
          aria-hidden="true"
          className="absolute -top-4 left-0 text-9xl font-bold opacity-5 pointer-events-none select-none uppercase tracking-widest"
        >
          KNOWLEDGE
        </div>
        <h1 className="relative text-4xl font-display font-bold text-slate-900 dark:text-slate-50 pt-6">
          Knowledge Base
        </h1>
      </div>

      {/* Page Content */}
    </PageContainer>
  );
}
```
