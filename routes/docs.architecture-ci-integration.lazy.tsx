import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureCiIntegrationContent from '../content/docs/architecture-ci-integration.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-ci-integration')({
  component: () => (
    <DocsPage id="architecture-ci-integration">
      <ArchitectureCiIntegrationContent />
    </DocsPage>
  )
})
