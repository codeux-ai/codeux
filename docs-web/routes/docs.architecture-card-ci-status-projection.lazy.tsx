import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureCardCiStatusProjectionContent from '../content/docs/architecture-card-ci-status-projection.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-card-ci-status-projection')({
  component: () => (
    <DocsPage id="architecture-card-ci-status-projection">
      <ArchitectureCardCiStatusProjectionContent />
    </DocsPage>
  )
})
