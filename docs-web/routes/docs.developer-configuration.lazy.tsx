import { createLazyFileRoute } from '@tanstack/react-router'
import DeveloperConfigurationContent from '../content/docs/developer-configuration.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/developer-configuration')({
  component: () => (
    <DocsPage id="developer-configuration">
      <DeveloperConfigurationContent />
    </DocsPage>
  )
})
