import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureExecutionInvocationTrackingContent from '../content/docs/architecture-execution-invocation-tracking.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-execution-invocation-tracking')({
  component: () => (
    <DocsPage id="architecture-execution-invocation-tracking">
      <ArchitectureExecutionInvocationTrackingContent />
    </DocsPage>
  )
})
