import { createLazyFileRoute } from '@tanstack/react-router'
import DeveloperFeatureFlagsContent from '../content/docs/developer-feature-flags.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/developer-feature-flags')({
  component: () => (
    <DocsPage id="developer-feature-flags">
      <DeveloperFeatureFlagsContent />
    </DocsPage>
  )
})
