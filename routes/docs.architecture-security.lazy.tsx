import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureSecurityContent from '../content/docs/architecture-security.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-security')({
  component: () => (
    <DocsPage id="architecture-security">
      <ArchitectureSecurityContent />
    </DocsPage>
  )
})
