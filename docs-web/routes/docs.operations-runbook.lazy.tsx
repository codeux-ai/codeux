import { createLazyFileRoute } from '@tanstack/react-router'
import OperationsRunbookContent from '../content/docs/operations-runbook.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/operations-runbook')({
  component: () => (
    <DocsPage id="operations-runbook">
      <OperationsRunbookContent />
    </DocsPage>
  )
})
