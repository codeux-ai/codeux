import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureDataModelContent from '../content/docs/architecture-data-model.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-data-model')({
  component: () => (
    <DocsPage id="architecture-data-model">
      <ArchitectureDataModelContent />
    </DocsPage>
  )
})
