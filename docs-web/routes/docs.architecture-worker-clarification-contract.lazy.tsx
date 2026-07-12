import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureWorkerClarificationContractContent from '../content/docs/architecture-worker-clarification-contract.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-worker-clarification-contract')({
  component: () => (
    <DocsPage id="architecture-worker-clarification-contract">
      <ArchitectureWorkerClarificationContractContent />
    </DocsPage>
  )
})
