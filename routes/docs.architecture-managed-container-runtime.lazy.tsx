import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureManagedContainerRuntimeContent from '../content/docs/architecture-managed-container-runtime.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-managed-container-runtime')({
  component: () => (
    <DocsPage id="architecture-managed-container-runtime">
      <ArchitectureManagedContainerRuntimeContent />
    </DocsPage>
  )
})
