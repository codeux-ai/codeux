import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureHighConcurrencyOrchestrationContent from '../content/docs/architecture-high-concurrency-orchestration.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-high-concurrency-orchestration')({
  component: () => (
    <DocsPage id="architecture-high-concurrency-orchestration">
      <ArchitectureHighConcurrencyOrchestrationContent />
    </DocsPage>
  )
})
