import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureNodeWorkflowPersistenceContent from '../content/docs/architecture-node-workflow-persistence.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-node-workflow-persistence')({
  component: () => (
    <DocsPage id="architecture-node-workflow-persistence">
      <ArchitectureNodeWorkflowPersistenceContent />
    </DocsPage>
  )
})
