import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureNodeFlowDurableExecutionContent from '../content/docs/architecture-node-flow-durable-execution.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-node-flow-durable-execution')({
  component: () => (
    <DocsPage id="architecture-node-flow-durable-execution">
      <ArchitectureNodeFlowDurableExecutionContent />
    </DocsPage>
  )
})
