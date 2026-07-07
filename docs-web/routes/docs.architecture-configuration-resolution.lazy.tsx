import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureConfigurationResolutionContent from '../content/docs/architecture-configuration-resolution.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-configuration-resolution')({
  component: () => (
    <DocsPage id="architecture-configuration-resolution">
      <ArchitectureConfigurationResolutionContent />
    </DocsPage>
  )
})
