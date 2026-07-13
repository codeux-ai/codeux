import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureSprintRollbacksContent from '../content/docs/architecture-sprint-rollbacks.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-sprint-rollbacks')({
  component: () => (
    <DocsPage id="architecture-sprint-rollbacks">
      <ArchitectureSprintRollbacksContent />
    </DocsPage>
  )
})
