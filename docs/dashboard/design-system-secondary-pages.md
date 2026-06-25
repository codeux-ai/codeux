# Secondary Pages Design System

This document outlines the design system rules for the dashboard's secondary pages, including the Scheduler, Knowledge, File Browser, and Error pages.

## Page Structure

Secondary pages must follow a consistent structural wrapper to maintain standard visual continuity across the dashboard.

- **PageContainer Wrapper**: All secondary pages must be wrapped in a `PageContainer` component. This ensures unified padding, layout behavior, and responsive constraints.

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
